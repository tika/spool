//
//  ContentView.swift
//  Spool
//
//  Created by Tika on 22/02/2026.
//

import AVFoundation
import Combine
import SwiftUI

// MARK: - Audio Player Manager (Singleton)

final class AudioPlayerManager: ObservableObject {
    static let shared = AudioPlayerManager()

    private var player: AVQueuePlayer?
    private var playerLooper: AVPlayerLooper?
    private var currentURL: URL?
    private(set) var activeViewId: String?

    @Published var isPlaying: Bool = false

    private init() {
        print("🔊 [AudioManager] Singleton initialized")
    }

    func getPlayer() -> AVPlayer? {
        return player
    }

    func isActiveView(_ viewId: String) -> Bool {
        return viewId == activeViewId
    }

    func play(url: URL, viewId: String) {
        let videoName = String(url.lastPathComponent.prefix(30))

        // If same URL and same view, just resume
        if url == currentURL && viewId == activeViewId {
            print("🔊 [AudioManager] ▶️  RESUME | view: \(viewId.prefix(6)) | video: \(videoName)")
            player?.play()
            isPlaying = true
            return
        }

        // If different view is requesting, take over
        if viewId != activeViewId {
            print("🔊 [AudioManager] 🔄 VIEW CHANGE | new: \(viewId.prefix(6)) | old: \(activeViewId?.prefix(6) ?? "none")")
        }

        activeViewId = viewId
        currentURL = url

        // Stop current playback
        player?.pause()
        player?.removeAllItems()
        playerLooper?.disableLooping()

        // Setup new player
        let item = AVPlayerItem(url: url)
        let newPlayer = AVQueuePlayer(items: [item])
        playerLooper = AVPlayerLooper(player: newPlayer, templateItem: item)
        newPlayer.isMuted = false
        player = newPlayer

        print("🔊 [AudioManager] ▶️  PLAY NEW | view: \(viewId.prefix(6)) | video: \(videoName)")
        newPlayer.play()
        isPlaying = true
    }

    func pause(viewId: String) {
        // Only pause if this view owns the player
        guard viewId == activeViewId else { return }

        let videoName = currentURL.map { String($0.lastPathComponent.prefix(30)) } ?? "none"
        print("🔊 [AudioManager] ⏸️  PAUSE | view: \(viewId.prefix(6)) | video: \(videoName)")
        player?.pause()
        isPlaying = false
    }

    func stop(viewId: String) {
        // Only stop if this view owns the player
        guard viewId == activeViewId else { return }

        let videoName = currentURL.map { String($0.lastPathComponent.prefix(30)) } ?? "none"
        print("🔊 [AudioManager] ⏹️  STOP | view: \(viewId.prefix(6)) | video: \(videoName)")

        player?.pause()
        player?.removeAllItems()
        playerLooper?.disableLooping()
        isPlaying = false
        activeViewId = nil
        currentURL = nil
    }

    func seekToBeginning(viewId: String) {
        guard viewId == activeViewId else { return }
        print("🔊 [AudioManager] ⏮️  SEEK TO START | view: \(viewId.prefix(6))")
        player?.seek(to: .zero)
    }

    func stopAll() {
        print("🔊 [AudioManager] ⏹️  STOP ALL - Leaving feed")
        player?.pause()
        player?.removeAllItems()
        playerLooper?.disableLooping()
        isPlaying = false
        activeViewId = nil
        currentURL = nil
    }
}

// MARK: - User Model

struct AppUser {
    let id: String
    let username: String

    static let defaultUser = AppUser(
        id: "469101a1-d58a-4184-919b-2f53a8ef34a7",
        username: "tika"
    )
}

// MARK: - API Models

struct FeedResponse: Codable {
    let item: FeedItem?
    let cursor: Int?
    let hasNext: Bool
    let hasPrev: Bool
}

enum FeedItem: Codable {
    case reel(ReelItem)
    case quiz(QuizItem)

    enum CodingKeys: String, CodingKey {
        case type
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "reel":
            self = .reel(try ReelItem(from: decoder))
        case "quiz":
            self = .quiz(try QuizItem(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown type: \(type)")
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .reel(let item):
            try item.encode(to: encoder)
        case .quiz(let item):
            try item.encode(to: encoder)
        }
    }
}

struct ReelItem: Codable, Identifiable {
    var id: String { conceptSlug }
    let conceptSlug: String
    let conceptName: String
    let conceptDescription: String
    let difficulty: Int
    let videoUrl: String?
}

struct QuizItem: Codable, Identifiable {
    var id: String { quizId }
    let quizId: String
    let question: String
    let answerChoices: [String]
    let correctAnswer: String
}

// MARK: - API Service

@MainActor
class FeedService: ObservableObject {
    static let shared = FeedService()

    private let baseURL = "http://localhost:3001"

    func fetchNextItem(topicSlug: String, username: String, cursor: Int) async throws -> FeedResponse {
        let url = URL(string: "\(baseURL)/feed/\(topicSlug)/\(username)/next?cursor=\(cursor)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(FeedResponse.self, from: data)
    }

    func fetchPrevItem(topicSlug: String, username: String, cursor: Int) async throws -> FeedResponse {
        let url = URL(string: "\(baseURL)/feed/\(topicSlug)/\(username)/prev?cursor=\(cursor)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(FeedResponse.self, from: data)
    }
}

// MARK: - UI Models

struct Topic: Identifiable {
    let id = UUID()
    let title: String
    let slug: String
    let subtitle: String
    let gradient: [Color]
}

// MARK: - Creator Models

struct Bounty: Identifiable {
    let id = UUID()
    let topic: String
    let question: String
    let revShare: String
}

struct CreatorVideo: Identifiable {
    let id = UUID()
    let title: String
    let topic: String
    let views: String
    let earnings: String
    let thumbnailColor: Color
}

// MARK: - App Tab

enum AppTab {
    case learn
    case creator
}

// MARK: - Content View (Root with Tabs)

struct ContentView: View {
    @State private var selectedTab: AppTab = .learn
    @State private var learningTopic: Topic?

    private let currentUser = AppUser.defaultUser

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                // Content area
                Group {
                    switch selectedTab {
                    case .learn:
                        LearnView(onStartLearning: { topic in
                            withAnimation(.spring(response: 0.5, dampingFraction: 0.88)) {
                                learningTopic = topic
                            }
                        })
                    case .creator:
                        CreatorView()
                    }
                }

                // Bottom tab bar
                TabBarView(selectedTab: $selectedTab)
            }
            .background(Color(red: 0.97, green: 0.96, blue: 0.94))

            // Learning view overlay
            if let topic = learningTopic {
                LearningView(topic: topic, username: currentUser.username) {
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.88)) {
                        learningTopic = nil
                    }
                }
                .transition(.move(edge: .trailing))
                .zIndex(1)
            }
        }
    }
}

// MARK: - Tab Bar View

struct TabBarView: View {
    @Binding var selectedTab: AppTab

    var body: some View {
        HStack(spacing: 0) {
            TabBarButton(
                title: "Learn",
                icon: "book.fill",
                isSelected: selectedTab == .learn
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    selectedTab = .learn
                }
            }

            TabBarButton(
                title: "Creator",
                icon: "sparkles",
                isSelected: selectedTab == .creator
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    selectedTab = .creator
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 28)
        .background {
            Rectangle()
                .fill(Color(red: 0.97, green: 0.96, blue: 0.94))
                .shadow(color: .black.opacity(0.05), radius: 8, y: -4)
        }
    }
}

struct TabBarButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .medium))
                Text(title)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(isSelected ? Color(red: 0.85, green: 0.55, blue: 0.15) : Color(red: 0.55, green: 0.50, blue: 0.45))
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Learn View

struct LearnView: View {
    let onStartLearning: (Topic) -> Void

    @State private var expandedTopicID: UUID?
    @State private var showingAddSheet = false
    @State private var visibleTopics: [Topic] = []
    @State private var loadingTopic: Topic?

    private static let allTopics: [Topic] = [
        Topic(
            title: "Differential Equations",
            slug: "differential-equations",
            subtitle: "15 concepts discovered",
            gradient: [
                Color(red: 0.95, green: 0.88, blue: 0.78),
                Color(red: 0.92, green: 0.82, blue: 0.72),
            ]
        ),
        Topic(
            title: "Black Holes",
            slug: "black-holes",
            subtitle: "Last viewed 24h ago",
            gradient: [
                Color(red: 0.38, green: 0.52, blue: 0.35),
                Color(red: 0.45, green: 0.55, blue: 0.38),
            ]
        ),
        Topic(
            title: "Black Holes",
            slug: "black-holes-2",
            subtitle: "Last viewed 24h ago",
            gradient: [
                Color(red: 0.72, green: 0.80, blue: 0.78),
                Color(red: 0.78, green: 0.82, blue: 0.76),
            ]
        ),
    ]

    private var availableTopics: [Topic] {
        let visibleIDs = Set(visibleTopics.map(\.title))
        return Self.allTopics.filter { !visibleIDs.contains($0.title) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerView

                ForEach(visibleTopics) { topic in
                    let isExpanded = expandedTopicID == topic.id

                    TopicCardView(
                        topic: topic,
                        isExpanded: isExpanded,
                        onStartLearning: {
                            onStartLearning(topic)
                        }
                    )
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.9).combined(with: .opacity),
                        removal: .opacity
                    ))
                    .onTapGesture {
                        withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                            expandedTopicID = isExpanded ? nil : topic.id
                        }
                    }
                }

                if let topic = loadingTopic {
                    LoadingCardView(topic: topic)
                        .transition(.scale(scale: 0.95).combined(with: .opacity))
                }

                if !availableTopics.isEmpty && loadingTopic == nil {
                    addButton
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 20)
        }
        .onAppear {
            if visibleTopics.isEmpty {
                visibleTopics = Self.allTopics
                expandedTopicID = Self.allTopics.first?.id
            }
        }
        .sheet(isPresented: $showingAddSheet) {
            AddTopicSheet(topics: availableTopics) { topic in
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                    loadingTopic = topic
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                        loadingTopic = nil
                        visibleTopics.append(topic)
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private var headerView: some View {
        HStack(spacing: 10) {
            Image(systemName: "cylinder.fill")
                .font(.system(size: 32))
                .foregroundStyle(
                    .linearGradient(
                        colors: [
                            Color(red: 0.90, green: 0.68, blue: 0.25),
                            Color(red: 0.85, green: 0.60, blue: 0.20),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Text("Spool")
                .font(.system(.title, design: .rounded, weight: .bold))
                .foregroundStyle(Color(red: 0.85, green: 0.55, blue: 0.15))

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var addButton: some View {
        Button {
            showingAddSheet = true
        } label: {
            HStack {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                Text("Add Topic")
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(Color(red: 0.55, green: 0.50, blue: 0.38))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(
                        Color(red: 0.55, green: 0.50, blue: 0.38).opacity(0.4),
                        style: StrokeStyle(lineWidth: 1.5, dash: [8, 6])
                    )
            }
        }
    }
}

// MARK: - Creator View

struct CreatorView: View {
    private let bounties: [Bounty] = [
        Bounty(topic: "Black Holes", question: "What's inside a black hole?", revShare: "$1.5x Rev Share")
    ]

    private let videos: [CreatorVideo] = [
        CreatorVideo(title: "The Chemistry of Black Holes", topic: "Black Holes", views: "16.3k", earnings: "$3.31", thumbnailColor: Color(red: 0.85, green: 0.75, blue: 0.65)),
        CreatorVideo(title: "The Chemistry of Black Holes", topic: "Black Holes", views: "16.3k", earnings: "$3.31", thumbnailColor: Color(red: 0.85, green: 0.75, blue: 0.65)),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerView

                // Trending Bounties
                VStack(alignment: .leading, spacing: 12) {
                    Text("Trending Bounties")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.20, green: 0.18, blue: 0.15))

                    ForEach(bounties) { bounty in
                        BountyCardView(bounty: bounty)
                    }
                }

                // Your Videos
                VStack(alignment: .leading, spacing: 16) {
                    Text("Your Videos")
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.20, green: 0.18, blue: 0.15))

                    ForEach(videos) { video in
                        VideoRowView(video: video)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 20)
        }
    }

    private var headerView: some View {
        HStack(spacing: 10) {
            Image(systemName: "cylinder.fill")
                .font(.system(size: 32))
                .foregroundStyle(
                    .linearGradient(
                        colors: [
                            Color(red: 0.90, green: 0.68, blue: 0.25),
                            Color(red: 0.85, green: 0.60, blue: 0.20),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

            Text("Spool")
                .font(.system(.title, design: .rounded, weight: .bold))
                .foregroundStyle(Color(red: 0.85, green: 0.55, blue: 0.15))

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Bounty Card View

struct BountyCardView: View {
    let bounty: Bounty

    var body: some View {
        ZStack {
            // Zigzag background with grain
            SideZigzagShape()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.92, green: 0.88, blue: 0.62),
                            Color(red: 0.88, green: 0.82, blue: 0.52),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .colorEffect(ShaderLibrary.grainNoise(.float(0.15)))

            VStack(alignment: .leading, spacing: 12) {
                Text(bounty.topic)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.55, green: 0.48, blue: 0.25))

                Text(bounty.question)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(red: 0.28, green: 0.25, blue: 0.18))

                Spacer()

                HStack {
                    Text(bounty.revShare)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.30, green: 0.28, blue: 0.12))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background {
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(Color(red: 0.85, green: 0.92, blue: 0.35))
                        }

                    Spacer()

                    Button {
                    } label: {
                        Text("Claim Bounty")
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background {
                                Capsule()
                                    .fill(Color(red: 0.12, green: 0.12, blue: 0.10))
                            }
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
        }
        .frame(height: 180)
    }
}

// MARK: - Side Zigzag Shape (zigzags on left and right edges)

struct SideZigzagShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let zigzagDepth: CGFloat = 10
        let zigzagHeight: CGFloat = 14

        // Start at top-left (indented by zigzag)
        path.move(to: CGPoint(x: zigzagDepth, y: 0))

        // Top edge (straight)
        path.addLine(to: CGPoint(x: rect.width - zigzagDepth, y: 0))

        // Right zigzag edge (going down)
        var y: CGFloat = 0
        var goingRight = true
        while y < rect.height {
            let nextY = min(y + zigzagHeight, rect.height)
            let x = goingRight ? rect.width : rect.width - zigzagDepth
            path.addLine(to: CGPoint(x: x, y: nextY))
            y = nextY
            goingRight.toggle()
        }

        // Bottom edge (straight)
        path.addLine(to: CGPoint(x: zigzagDepth, y: rect.height))

        // Left zigzag edge (going up)
        y = rect.height
        goingRight = true
        while y > 0 {
            let nextY = max(y - zigzagHeight, 0)
            let x = goingRight ? 0 : zigzagDepth
            path.addLine(to: CGPoint(x: x, y: nextY))
            y = nextY
            goingRight.toggle()
        }

        path.closeSubpath()
        return path
    }
}

// MARK: - Video Row View

struct VideoRowView: View {
    let video: CreatorVideo

    var body: some View {
        HStack(spacing: 14) {
            // Thumbnail placeholder
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(video.thumbnailColor)
                .frame(width: 80, height: 80)
                .overlay {
                    // Simulated person silhouette
                    Image(systemName: "person.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.white.opacity(0.6))
                }

            VStack(alignment: .leading, spacing: 4) {
                Text(video.title)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.20, green: 0.18, blue: 0.15))
                    .lineLimit(2)

                Text(video.topic)
                    .font(.system(size: 14, weight: .regular, design: .rounded))
                    .foregroundStyle(Color(red: 0.50, green: 0.48, blue: 0.42))

                HStack(spacing: 16) {
                    HStack(spacing: 4) {
                        Image(systemName: "eye")
                            .font(.system(size: 13))
                        Text(video.views)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                    }
                    .foregroundStyle(Color(red: 0.40, green: 0.38, blue: 0.32))

                    HStack(spacing: 4) {
                        Image(systemName: "dollarsign.square")
                            .font(.system(size: 13))
                        Text(video.earnings)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                    }
                    .foregroundStyle(Color(red: 0.40, green: 0.38, blue: 0.32))
                }
                .padding(.top, 2)
            }

            Spacer()
        }
    }
}


// MARK: - Topic Card View

struct TopicCardView: View {
    let topic: Topic
    let isExpanded: Bool
    var onStartLearning: (() -> Void)?

    private var cornerRadius: CGFloat { isExpanded ? 24 : 18 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isExpanded {
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: isExpanded ? 6 : 4) {
                        Text(topic.title)
                            .font(
                                isExpanded
                                    ? .system(size: 34, weight: .bold, design: .rounded)
                                    : .system(size: 17, weight: .semibold, design: .rounded)
                            )
                            .foregroundStyle(
                                isExpanded
                                    ? Color(red: 0.30, green: 0.28, blue: 0.22)
                                    : Color(red: 0.20, green: 0.22, blue: 0.18)
                            )

                        Text(topic.subtitle)
                            .font(
                                .system(
                                    size: 15,
                                    weight: isExpanded ? .medium : .regular,
                                    design: .rounded
                                )
                            )
                            .foregroundStyle(
                                isExpanded
                                    ? Color(red: 0.55, green: 0.52, blue: 0.42)
                                    : Color(red: 0.20, green: 0.22, blue: 0.18).opacity(0.7)
                            )
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(red: 0.20, green: 0.22, blue: 0.18))
                        .opacity(isExpanded ? 0 : 1)
                }

                if isExpanded {
                    Button {
                        onStartLearning?()
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 14))
                            Text("Start Learning")
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background {
                            Capsule()
                                .fill(Color(red: 0.30, green: 0.28, blue: 0.22))
                        }
                    }
                    .transition(.opacity.combined(with: .offset(y: 8)))
                }
            }
            .padding(isExpanded ? 24 : 20)
        }
        .frame(height: isExpanded ? 420 : nil)
        .background {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: topic.gradient,
                        startPoint: .topTrailing,
                        endPoint: .bottomLeading
                    )
                )
                .colorEffect(
                    ShaderLibrary.grainNoise(.float(0.15))
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

// MARK: - Loading Card View

struct LoadingCardView: View {
    let topic: Topic
    @State private var shimmer = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.white.opacity(0.35))
                    .frame(width: 140, height: 14)

                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Color.white.opacity(0.2))
                    .frame(width: 100, height: 12)
            }

            Spacer()

            ProgressView()
                .tint(Color.white.opacity(0.6))
        }
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: topic.gradient,
                        startPoint: .topTrailing,
                        endPoint: .bottomLeading
                    )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0),
                                    Color.white.opacity(0.15),
                                    Color.white.opacity(0),
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .offset(x: shimmer ? 300 : -300)
                }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .colorEffect(ShaderLibrary.grainNoise(.float(0.15)))
        }
        .onAppear {
            withAnimation(
                .easeInOut(duration: 1.2)
                .repeatForever(autoreverses: false)
            ) {
                shimmer = true
            }
        }
    }
}

// MARK: - Feed View Model

@MainActor
class FeedViewModel: ObservableObject {
    @Published var items: [FeedItem] = []
    @Published var currentIndex: Int = 0
    @Published var isLoading = false
    @Published var hasNext = true
    @Published var hasPrev = false

    private let topicSlug: String
    private let username: String
    private var currentCursor = 0
    private var isPreloading = false

    init(topicSlug: String, username: String) {
        self.topicSlug = topicSlug
        self.username = username
    }

    func loadInitial() async {
        guard items.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await FeedService.shared.fetchNextItem(
                topicSlug: topicSlug,
                username: username,
                cursor: 0
            )

            if let item = response.item {
                items = [item]
                currentCursor = response.cursor ?? 0
                hasNext = response.hasNext
                hasPrev = response.hasPrev
            }

            // Preload next item
            await preloadNext()
        } catch {
            print("Error loading initial feed: \(error)")
        }
    }

    func preloadNext() async {
        guard hasNext, !isPreloading else { return }
        isPreloading = true
        defer { isPreloading = false }

        let nextCursor = currentCursor + 1

        do {
            let response = try await FeedService.shared.fetchNextItem(
                topicSlug: topicSlug,
                username: username,
                cursor: nextCursor
            )

            if let item = response.item {
                // Only add if not already present
                let existingIds = Set(items.compactMap { feedItemId($0) })
                if !existingIds.contains(feedItemId(item)) {
                    items.append(item)
                }
                hasNext = response.hasNext
            }
        } catch {
            print("Error preloading next: \(error)")
        }
    }

    func onScrolledTo(index: Int) {
        currentIndex = index
        currentCursor = index

        // Preload when user is near the end
        if index >= items.count - 2 && hasNext {
            Task {
                await preloadNext()
            }
        }
    }

    private func feedItemId(_ item: FeedItem) -> String {
        switch item {
        case .reel(let reel): return reel.id
        case .quiz(let quiz): return quiz.id
        }
    }
}

// MARK: - Learning View

struct LearningView: View {
    let topic: Topic
    let username: String
    let onExit: () -> Void

    @StateObject private var viewModel: FeedViewModel
    @State private var currentItemID: String?

    init(topic: Topic, username: String, onExit: @escaping () -> Void) {
        self.topic = topic
        self.username = username
        self.onExit = onExit
        _viewModel = StateObject(wrappedValue: FeedViewModel(topicSlug: topic.slug, username: username))
    }

    private var currentItem: FeedItem? {
        viewModel.items.first { feedItemId($0) == currentItemID }
    }

    private var currentItemLabel: String {
        guard let item = currentItem else { return "" }
        switch item {
        case .reel(let reel): return reel.conceptName
        case .quiz: return "Quiz"
        }
    }

    var body: some View {
        ZStack {
            if viewModel.isLoading && viewModel.items.isEmpty {
                ProgressView()
                    .tint(.white)
            } else {
                // Scrolling video/quiz pages
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(viewModel.items.enumerated()), id: \.offset) { index, item in
                            let itemId = feedItemId(item)
                            FeedItemPageView(item: item, isCurrentItem: currentItemID == itemId)
                                .containerRelativeFrame(.vertical)
                                .id(itemId)
                                .onAppear {
                                    viewModel.onScrolledTo(index: index)
                                }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollIndicators(.hidden)
                .scrollPosition(id: $currentItemID)
                .ignoresSafeArea()
                .onAppear {
                    // Set initial current item if not set
                    if currentItemID == nil, let firstItem = viewModel.items.first {
                        currentItemID = feedItemId(firstItem)
                        print("📍 [LearningView] Set initial currentItemID: \(currentItemID ?? "nil")")
                    }
                }
                .onChange(of: viewModel.items.count) { _, count in
                    // Set initial current item when items load
                    if currentItemID == nil, count > 0, let firstItem = viewModel.items.first {
                        currentItemID = feedItemId(firstItem)
                        print("📍 [LearningView] Items loaded (\(count)), set currentItemID: \(currentItemID ?? "nil")")
                    }
                }
            }

            // Fixed top gradient scrim
            VStack {
                LinearGradient(
                    colors: [.black.opacity(0.5), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 160)
                .ignoresSafeArea(edges: .top)

                Spacer()
            }
            .allowsHitTesting(false)

            // Fixed header + bottom caption
            VStack(spacing: 0) {
                ZStack {
                    VStack(spacing: 4) {
                        Text(topic.title)
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)

                        Text(currentItemLabel)
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.6))
                            .contentTransition(.numericText())
                            .animation(.easeInOut(duration: 0.3), value: currentItemID)
                    }

                    HStack {
                        Button {
                            onExit()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "chevron.left")
                                    .font(.system(size: 16, weight: .bold, design: .rounded))
                                Text("Exit")
                                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                            }
                            .foregroundStyle(.white)
                        }
                        Spacer()
                    }
                    .padding(.leading, 16)
                }
                .padding(.top, 60)

                Spacer()

                if let item = currentItem {
                    bottomCaptionView(for: item)
                        .animation(.easeInOut(duration: 0.3), value: currentItemID)
                }
            }
        }
        .background(.black)
        .task {
            await viewModel.loadInitial()
            if let firstItem = viewModel.items.first {
                currentItemID = feedItemId(firstItem)
            }
        }
        .onDisappear {
            AudioPlayerManager.shared.stopAll()
        }
    }

    @ViewBuilder
    private func bottomCaptionView(for item: FeedItem) -> some View {
        switch item {
        case .reel(let reel):
            VStack(spacing: 16) {
                Text(reel.conceptDescription)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)

                RoundedRectangle(cornerRadius: 2)
                    .fill(Color(red: 0.95, green: 0.80, blue: 0.20))
                    .frame(height: 3)
                    .padding(.horizontal, 20)
            }
            .padding(.bottom, 24)

        case .quiz(let quiz):
            VStack(spacing: 16) {
                Text(quiz.question)
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
            }
            .padding(.bottom, 24)
        }
    }

    private func feedItemId(_ item: FeedItem) -> String {
        switch item {
        case .reel(let reel): return reel.id
        case .quiz(let quiz): return quiz.id
        }
    }
}

// MARK: - Feed Item Page View

struct FeedItemPageView: View {
    let item: FeedItem
    let isCurrentItem: Bool

    var body: some View {
        switch item {
        case .reel(let reel):
            ReelPageView(reel: reel, isCurrentItem: isCurrentItem)
        case .quiz(let quiz):
            QuizPageView(quiz: quiz)
        }
    }
}

// MARK: - Reel Page View

struct ReelPageView: View {
    let reel: ReelItem
    let isCurrentItem: Bool
    @State private var userPaused = false  // Track if user manually paused

    private var videoName: String {
        guard let urlString = reel.videoUrl,
              let url = URL(string: urlString) else { return "no-url" }
        return String(url.lastPathComponent.prefix(30))
    }

    // Play only if: this is the current item AND user hasn't paused
    private var shouldPlay: Bool {
        isCurrentItem && !userPaused
    }

    var body: some View {
        ZStack {
            if let videoUrlString = reel.videoUrl, let url = URL(string: videoUrlString) {
                SingletonPlayerView(url: url, viewId: reel.id, isPlaying: .constant(shouldPlay))
                    .ignoresSafeArea()
                    .onTapGesture {
                        print("👆 [ReelPage] TAP | video: \(videoName) | userPaused: \(!userPaused)")
                        userPaused.toggle()
                    }

                if !shouldPlay && isCurrentItem {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(.white.opacity(0.7))
                        .transition(.opacity)
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "video.slash")
                        .font(.system(size: 48))
                        .foregroundStyle(.white.opacity(0.5))

                    Text("Video not available")
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
        }
        .onChange(of: isCurrentItem) { _, isCurrent in
            print("📱 [ReelPage] isCurrentItem changed to \(isCurrent) | video: \(videoName)")
            if isCurrent {
                userPaused = false  // Reset pause state when becoming current
            }
        }
    }
}

// MARK: - Confetti Particle

struct ConfettiParticle: Identifiable {
    let id = UUID()
    var x: CGFloat
    var y: CGFloat
    var rotation: Double
    var scale: CGFloat
    var opacity: Double
    let color: Color
    let velocityX: CGFloat
    let velocityY: CGFloat
    let rotationSpeed: Double
}

// MARK: - Confetti View

struct ConfettiView: View {
    let isEmitting: Bool
    let origin: CGPoint

    @State private var particles: [ConfettiParticle] = []

    private let colors: [Color] = [
        .yellow, .green, .pink, .orange, .cyan, .purple, .mint
    ]

    var body: some View {
        ZStack {
            ForEach(particles) { particle in
                RoundedRectangle(cornerRadius: 2)
                    .fill(particle.color)
                    .frame(width: 8, height: 8)
                    .scaleEffect(particle.scale)
                    .rotationEffect(.degrees(particle.rotation))
                    .opacity(particle.opacity)
                    .position(x: particle.x, y: particle.y)
            }
        }
        .onChange(of: isEmitting) { _, emitting in
            if emitting {
                emitConfetti()
            }
        }
    }

    private func emitConfetti() {
        // Create initial particles at origin
        var newParticles: [ConfettiParticle] = []
        for _ in 0..<40 {
            let angle = Double.random(in: -Double.pi...0) // Upward spread
            let speed = CGFloat.random(in: 300...600)
            let particle = ConfettiParticle(
                x: origin.x,
                y: origin.y,
                rotation: Double.random(in: 0...360),
                scale: CGFloat.random(in: 0.5...1.2),
                opacity: 1.0,
                color: colors.randomElement()!,
                velocityX: cos(angle) * speed * CGFloat.random(in: 0.5...1.5),
                velocityY: sin(angle) * speed,
                rotationSpeed: Double.random(in: -720...720)
            )
            newParticles.append(particle)
        }
        particles = newParticles

        // Animate particles
        animateParticles()
    }

    private func animateParticles() {
        let gravity: CGFloat = 800
        let friction: CGFloat = 0.98
        let duration: Double = 2.0
        let steps = 60
        let dt = duration / Double(steps)

        for step in 0..<steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * dt) {
                withAnimation(.linear(duration: dt)) {
                    particles = particles.map { particle in
                        var p = particle
                        p.x += p.velocityX * CGFloat(dt)
                        p.y += p.velocityY * CGFloat(dt) + 0.5 * gravity * CGFloat(dt * dt)
                        p.rotation += p.rotationSpeed * dt
                        p.opacity = max(0, 1.0 - Double(step) / Double(steps - 10))
                        return ConfettiParticle(
                            x: p.x,
                            y: p.y,
                            rotation: p.rotation,
                            scale: p.scale,
                            opacity: p.opacity,
                            color: p.color,
                            velocityX: p.velocityX * friction,
                            velocityY: p.velocityY + gravity * CGFloat(dt),
                            rotationSpeed: p.rotationSpeed
                        )
                    }
                }
            }
        }

        // Clear particles after animation
        DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.1) {
            particles = []
        }
    }
}

// MARK: - Shake Effect Modifier

struct ShakeEffect: GeometryEffect {
    var amount: CGFloat = 10
    var shakesPerUnit: CGFloat = 3
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        let translation = amount * sin(animatableData * .pi * shakesPerUnit)
        return ProjectionTransform(CGAffineTransform(translationX: translation, y: 0))
    }
}

// MARK: - Quiz Answer Button

struct QuizAnswerButton: View {
    let answer: String
    let isCorrect: Bool
    let isSelected: Bool
    let showResult: Bool
    let onTap: () -> Void

    @State private var shakeAttempts: CGFloat = 0
    @State private var isPulsing = false
    @State private var buttonFrame: CGRect = .zero
    @State private var showConfetti = false

    var body: some View {
        ZStack {
            Button {
                onTap()

                if showResult { return }

                if isCorrect {
                    // Correct answer - trigger confetti
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                        showConfetti = true
                    }
                } else {
                    // Wrong answer - shake and pulse red
                    withAnimation(.linear(duration: 0.5)) {
                        shakeAttempts += 1
                    }
                    isPulsing = true

                    // Reset pulse after delay
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        withAnimation(.easeOut(duration: 0.3)) {
                            isPulsing = false
                        }
                    }
                }
            } label: {
                Text(answer)
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(textColor)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background {
                        GeometryReader { geo in
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(backgroundColor)
                                .preference(key: ButtonFramePreferenceKey.self, value: geo.frame(in: .global))
                        }
                    }
            }
            .modifier(ShakeEffect(animatableData: shakeAttempts))
            .disabled(showResult)
            .onPreferenceChange(ButtonFramePreferenceKey.self) { frame in
                buttonFrame = frame
            }
        }
    }

    private var textColor: Color {
        if !showResult { return .white }
        if isCorrect { return .white }
        if isSelected { return .white }
        return .white.opacity(0.5)
    }

    private var backgroundColor: Color {
        // During shake animation (wrong answer selected)
        if isPulsing && isSelected {
            return Color.red.opacity(0.7)
        }

        if !showResult { return .white.opacity(0.15) }

        if isCorrect {
            return Color.green.opacity(0.6)
        }
        if isSelected {
            return Color.red.opacity(0.5)
        }
        return .white.opacity(0.1)
    }
}

struct ButtonFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        value = nextValue()
    }
}

// MARK: - Quiz Page View

struct QuizPageView: View {
    let quiz: QuizItem
    @State private var selectedAnswer: String?
    @State private var showResult = false
    @State private var confettiOrigin: CGPoint = .zero
    @State private var showConfetti = false
    @State private var answerFrames: [String: CGRect] = [:]

    var body: some View {
        ZStack {
            VStack(spacing: 24) {
                Spacer()

                Text(quiz.question)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                VStack(spacing: 12) {
                    ForEach(quiz.answerChoices, id: \.self) { answer in
                        QuizAnswerButtonWrapper(
                            answer: answer,
                            isCorrect: answer == quiz.correctAnswer,
                            isSelected: selectedAnswer == answer,
                            showResult: showResult,
                            onTap: {
                                handleAnswerTap(answer)
                            },
                            onFrameChange: { frame in
                                answerFrames[answer] = frame
                            }
                        )
                    }
                }
                .padding(.horizontal, 24)

                Spacer()
            }

            // Confetti overlay
            ConfettiView(isEmitting: showConfetti, origin: confettiOrigin)
                .allowsHitTesting(false)
        }
    }

    private func handleAnswerTap(_ answer: String) {
        guard !showResult else { return }

        selectedAnswer = answer
        showResult = true

        if answer == quiz.correctAnswer {
            // Set confetti origin to center of correct answer button
            if let frame = answerFrames[answer] {
                confettiOrigin = CGPoint(x: frame.midX, y: frame.midY)
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                showConfetti = true
            }
        }
    }
}

// MARK: - Quiz Answer Button Wrapper

struct QuizAnswerButtonWrapper: View {
    let answer: String
    let isCorrect: Bool
    let isSelected: Bool
    let showResult: Bool
    let onTap: () -> Void
    let onFrameChange: (CGRect) -> Void

    @State private var shakeAttempts: CGFloat = 0
    @State private var isPulsing = false
    @State private var scaleEffect: CGFloat = 1.0

    var body: some View {
        Button {
            if showResult { return }
            onTap()

            if isCorrect {
                // Correct - scale pop effect
                withAnimation(.spring(response: 0.3, dampingFraction: 0.5)) {
                    scaleEffect = 1.1
                }
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7).delay(0.15)) {
                    scaleEffect = 1.0
                }
            } else {
                // Wrong - shake and pulse
                withAnimation(.linear(duration: 0.5)) {
                    shakeAttempts += 1
                }
                isPulsing = true

                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    withAnimation(.easeOut(duration: 0.4)) {
                        isPulsing = false
                    }
                }
            }
        } label: {
            Text(answer)
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background {
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(backgroundColor)
                            .onAppear {
                                onFrameChange(geo.frame(in: .global))
                            }
                            .onChange(of: geo.frame(in: .global)) { _, newFrame in
                                onFrameChange(newFrame)
                            }
                    }
                }
        }
        .scaleEffect(scaleEffect)
        .modifier(ShakeEffect(animatableData: shakeAttempts))
        .disabled(showResult)
    }

    private var textColor: Color {
        if !showResult { return .white }
        if isCorrect { return .white }
        if isSelected { return .white }
        return .white.opacity(0.5)
    }

    private var backgroundColor: Color {
        if isPulsing && isSelected {
            return Color.red.opacity(0.8)
        }

        if !showResult { return .white.opacity(0.15) }

        if isCorrect {
            return Color.green.opacity(0.7)
        }
        if isSelected {
            return Color.red.opacity(0.5)
        }
        return .white.opacity(0.1)
    }
}


// MARK: - Singleton Player View (uses shared AudioPlayerManager)

struct SingletonPlayerView: UIViewRepresentable {
    let url: URL
    let viewId: String
    @Binding var isPlaying: Bool

    func makeUIView(context: Context) -> SingletonPlayerUIView {
        let view = SingletonPlayerUIView(url: url, viewId: viewId)
        return view
    }

    func updateUIView(_ uiView: SingletonPlayerUIView, context: Context) {
        // Update URL if changed
        if url != uiView.currentURL {
            uiView.updateURL(url)
        }

        // Handle play/pause and sync layer
        if isPlaying {
            uiView.play()
        } else {
            uiView.pause()
        }

        // Always sync the layer - only show video if this view is active
        uiView.syncPlayerLayer()
    }
}

final class SingletonPlayerUIView: UIView {
    private let playerLayer = AVPlayerLayer()
    private let viewId: String
    private(set) var currentURL: URL

    init(url: URL, viewId: String) {
        self.viewId = viewId
        self.currentURL = url
        super.init(frame: .zero)

        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }

    func updateURL(_ url: URL) {
        currentURL = url
    }

    func syncPlayerLayer() {
        // Only connect layer to player if this view is the active one
        if AudioPlayerManager.shared.isActiveView(viewId) {
            if playerLayer.player == nil {
                print("📺 [\(viewId.prefix(6))] Connecting layer to player")
            }
            playerLayer.player = AudioPlayerManager.shared.getPlayer()
        } else {
            if playerLayer.player != nil {
                print("📺 [\(viewId.prefix(6))] Disconnecting layer (not active)")
            }
            playerLayer.player = nil
        }
    }

    func play() {
        AudioPlayerManager.shared.play(url: currentURL, viewId: viewId)
        syncPlayerLayer()
    }

    func pause() {
        AudioPlayerManager.shared.pause(viewId: viewId)
    }
}

// MARK: - Add Topic Sheet

struct AddTopicSheet: View {
    let topics: [Topic]
    let onAdd: (Topic) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(topics) { topic in
                Button {
                    onAdd(topic)
                    dismiss()
                } label: {
                    HStack(spacing: 14) {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: topic.gradient,
                                    startPoint: .topTrailing,
                                    endPoint: .bottomLeading
                                )
                            )
                            .frame(width: 44, height: 44)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(topic.title)
                                .font(.system(size: 17, weight: .semibold, design: .rounded))
                            Text(topic.subtitle)
                                .font(.system(size: 14, weight: .regular, design: .rounded))
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(Color(red: 0.85, green: 0.55, blue: 0.15))
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Color(red: 0.97, green: 0.96, blue: 0.94))
            }
            .listStyle(.plain)
            .navigationTitle("Add Topic")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .fontDesign(.rounded)
    }
}

// MARK: - Preview

#Preview {
    ContentView()
}
