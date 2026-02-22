//
//  ContentView.swift
//  Spool
//
//  Created by Tika on 22/02/2026.
//

import AVFoundation
import Combine
import CoreMedia
import SwiftUI

// MARK: - Audio Player Manager (Singleton)

final class AudioPlayerManager: ObservableObject {
    static let shared = AudioPlayerManager()

    private var player: AVQueuePlayer?
    private var playerLooper: AVPlayerLooper?
    private var currentURL: URL?
    private var timeObserverToken: Any?
    private(set) var activeViewId: String?

    @Published var isPlaying: Bool = false
    @Published var currentPlaybackTime: Double = 0

    private init() {}

    func getPlayer() -> AVPlayer? {
        return player
    }

    func isActiveView(_ viewId: String) -> Bool {
        return viewId == activeViewId
    }

    private func removeTimeObserver() {
        guard let token = timeObserverToken, let p = player else { return }
        p.removeTimeObserver(token)
        timeObserverToken = nil
    }

    private func addTimeObserver(to player: AVPlayer) {
        removeTimeObserver()
        let interval = CMTime(seconds: 0.05, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            DispatchQueue.main.async {
                self?.currentPlaybackTime = time.seconds
            }
        }
    }

    func play(url: URL, viewId: String) {
        // If same URL and same view, just resume
        if url == currentURL && viewId == activeViewId {
            player?.play()
            DispatchQueue.main.async { [weak self] in
                self?.isPlaying = true
            }
            return
        }

        activeViewId = viewId
        currentURL = url

        // Stop current playback
        removeTimeObserver()
        player?.pause()
        player?.removeAllItems()
        playerLooper?.disableLooping()

        // Setup new player
        let item = AVPlayerItem(url: url)
        let newPlayer = AVQueuePlayer(items: [item])
        playerLooper = AVPlayerLooper(player: newPlayer, templateItem: item)
        newPlayer.isMuted = false
        player = newPlayer

        addTimeObserver(to: newPlayer)
        newPlayer.play()
        DispatchQueue.main.async { [weak self] in
            self?.isPlaying = true
        }
    }

    func pause(viewId: String) {
        guard viewId == activeViewId else { return }
        player?.pause()
        DispatchQueue.main.async { [weak self] in
            self?.isPlaying = false
        }
    }

    func stop(viewId: String) {
        guard viewId == activeViewId else { return }
        removeTimeObserver()
        player?.pause()
        player?.removeAllItems()
        playerLooper?.disableLooping()
        DispatchQueue.main.async { [weak self] in
            self?.isPlaying = false
            self?.currentPlaybackTime = 0
        }
        activeViewId = nil
        currentURL = nil
    }

    func seekToBeginning(viewId: String) {
        guard viewId == activeViewId else { return }
        player?.seek(to: .zero)
    }

    func stopAll() {
        removeTimeObserver()
        player?.pause()
        player?.removeAllItems()
        playerLooper?.disableLooping()
        DispatchQueue.main.async { [weak self] in
            self?.isPlaying = false
            self?.currentPlaybackTime = 0
        }
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

struct APIError: Codable {
    let code: String?
    let message: String?
}

struct APIErrorResponse: Codable {
    let error: APIError?
}

struct FeedResponse: Codable {
    let item: FeedItem?
    let cursor: Int?
    let hasNext: Bool
    let hasPrev: Bool
    let error: APIError?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Check if this is an error response
        if let errorContainer = try? container.decode(APIError.self, forKey: .error) {
            self.error = errorContainer
            self.item = nil
            self.cursor = nil
            self.hasNext = false
            self.hasPrev = false
            return
        }

        self.error = nil
        self.item = try container.decodeIfPresent(FeedItem.self, forKey: .item)
        self.cursor = try container.decodeIfPresent(Int.self, forKey: .cursor)
        self.hasNext = try container.decodeIfPresent(Bool.self, forKey: .hasNext) ?? false
        self.hasPrev = try container.decodeIfPresent(Bool.self, forKey: .hasPrev) ?? false
    }

    enum CodingKeys: String, CodingKey {
        case item, cursor, hasNext, hasPrev, error
    }
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

struct CaptionWord: Codable {
    let word: String
    let startTime: Double
    let endTime: Double
}

struct ReelItem: Codable, Identifiable {
    var id: String { conceptSlug }
    let conceptSlug: String
    let conceptName: String
    let conceptDescription: String
    let difficulty: Int
    let videoUrl: String?
    let audioUrl: String?
    let captions: [CaptionWord]?
    let durationSeconds: Double?

    var hasVideo: Bool {
        if let url = videoUrl, !url.isEmpty { return true }
        return false
    }

    var hasAudio: Bool {
        if let url = audioUrl, !url.isEmpty { return true }
        return false
    }
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

    func fetchTopics() async throws -> [Topic] {
        let url = URL(string: "\(baseURL)/topics")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(TopicsAPIResponse.self, from: data)
        return response.topics.map { Topic(from: $0) }
    }

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

private struct TopicsAPIResponse: Decodable {
    let topics: [TopicAPI]
}

private struct TopicAPI: Decodable {
    let slug: String
    let name: String
    let status: String
    let conceptCount: Int?
    let createdAt: String
}

struct Topic: Identifiable {
    let id: String
    let title: String
    let slug: String
    let subtitle: String
    let gradient: [Color]
    let status: String

    init(id: String, title: String, slug: String, subtitle: String, gradient: [Color], status: String = "ready") {
        self.id = id
        self.title = title
        self.slug = slug
        self.subtitle = subtitle
        self.gradient = gradient
        self.status = status
    }

    fileprivate init(from api: TopicAPI) {
        self.id = api.slug
        self.title = api.name
        self.slug = api.slug
        self.subtitle = api.status == "ready"
            ? "\(api.conceptCount ?? 0) concepts discovered"
            : (api.status == "generating" ? "Generating..." : "Unavailable")
        self.gradient = Topic.gradientPalette(for: api.slug)
        self.status = api.status
    }

    private static let gradientPalette: [[Color]] = [
        [Color(red: 0.95, green: 0.88, blue: 0.78), Color(red: 0.92, green: 0.82, blue: 0.72)],
        [Color(red: 0.38, green: 0.52, blue: 0.35), Color(red: 0.45, green: 0.55, blue: 0.38)],
        [Color(red: 0.45, green: 0.55, blue: 0.65), Color(red: 0.38, green: 0.48, blue: 0.58)],
        [Color(red: 0.65, green: 0.45, blue: 0.55), Color(red: 0.58, green: 0.38, blue: 0.48)],
        [Color(red: 0.55, green: 0.65, blue: 0.45), Color(red: 0.48, green: 0.58, blue: 0.38)],
    ]

    private static func gradientPalette(for slug: String) -> [Color] {
        let index = abs(slug.hashValue) % gradientPalette.count
        return gradientPalette[index]
    }
}

// MARK: - Creator Models

struct Bounty: Identifiable {
    let id = UUID()
    let topic: String
    let question: String
    let revShare: String
    let description: String?
    let struggleStat: String?

    init(topic: String, question: String, revShare: String, description: String? = nil, struggleStat: String? = nil) {
        self.topic = topic
        self.question = question
        self.revShare = revShare
        self.description = description
        self.struggleStat = struggleStat
    }
}

struct CreatorVideo: Identifiable {
    let id = UUID()
    let title: String
    let topic: String
    let views: String
    let earnings: String
    let thumbnailURL: String
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

    @State private var expandedTopicID: String?
    @State private var allTopics: [Topic] = []
    @State private var visibleTopics: [Topic] = []
    @State private var loadingTopic: Topic?
    @State private var isLoading = true
    @State private var loadError: String?

    private var availableTopics: [Topic] {
        let visibleSlugs = Set(visibleTopics.map(\.slug))
        return allTopics.filter { !visibleSlugs.contains($0.slug) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerView

                if isLoading {
                    HStack {
                        Spacer()
                        ProgressView()
                            .scaleEffect(1.2)
                            .padding(.vertical, 40)
                        Spacer()
                    }
                } else if let error = loadError {
                    HStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        Text(error)
                            .font(.system(size: 15, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                } else {
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

                if loadingTopic == nil {
                    addTopicSection
                }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 20)
        }
        .task {
            await loadTopics()
        }
    }

    private func loadTopics() async {
        isLoading = true
        loadError = nil
        do {
            let topics = try await FeedService.shared.fetchTopics()
            let readyTopics = topics.filter { $0.status == "ready" }
            allTopics = readyTopics
            if visibleTopics.isEmpty {
                visibleTopics = readyTopics
                expandedTopicID = readyTopics.first?.id
            }
        } catch {
            loadError = "Could not load topics"
        }
        isLoading = false
    }

    private var headerView: some View {
        HStack(spacing: 10) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(height: 32)

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var addTopicSection: some View {
        Group {
            if availableTopics.isEmpty {
                HStack {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 16))
                    Text("All topics added")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                }
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
            } else {
                Menu {
                    ForEach(availableTopics) { topic in
                        Button {
                            addTopic(topic)
                        } label: {
                            Label(topic.title, systemImage: "plus.circle")
                        }
                    }
                } label: {
                    HStack {
                        Image(systemName: "plus.circle")
                            .font(.system(size: 17, weight: .medium))
                        Text("Add Topic")
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
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
                .menuStyle(.borderlessButton)
            }
        }
    }

    private func addTopic(_ topic: Topic) {
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
}

// MARK: - Creator View

struct CreatorView: View {
    @State private var selectedBounty: Bounty?

    private let bounties: [Bounty] = [
        Bounty(
            topic: "Black Holes",
            question: "What's inside a black hole?",
            revShare: "$1.5x Rev Share",
            description: "Some text here explaining the bounty. Create a short video that explains what happens inside a black hole's event horizon in an accessible way for learners.",
            struggleStat: "30% Users are struggling with XYZ"
        )
    ]

    private let videos: [CreatorVideo] = [
        CreatorVideo(title: "The Chemistry of Black Holes", topic: "Black Holes", views: "16.3k", earnings: "$3.31", thumbnailURL: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&h=400&fit=crop"),
        CreatorVideo(title: "The Chemistry of Black Holes", topic: "Black Holes", views: "16.3k", earnings: "$3.31", thumbnailURL: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&h=400&fit=crop"),
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
                        Button {
                            selectedBounty = bounty
                        } label: {
                            BountyCardView(bounty: bounty)
                        }
                        .buttonStyle(.plain)
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
        .sheet(item: $selectedBounty) { bounty in
            BountyDetailView(bounty: bounty) {
                selectedBounty = nil
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var headerView: some View {
        HStack(spacing: 10) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(height: 32)

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

// MARK: - Bounty Detail View

struct BountyDetailView: View {
    let bounty: Bounty
    let onDismiss: () -> Void

    // Removed unused private colors

    var body: some View {
        VStack(spacing: 0) {
            // Header (coin + Spool text)
            HStack(spacing: 9) {
                Image("Logo")
                    .resizable()
                    .frame(width: 36, height: 36)
                Text("Spool")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(red: 0.85, green: 0.55, blue: 0.15))
                Spacer()
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 19)

            Spacer(minLength: 10)

            // Popup main card
            VStack(alignment: .leading, spacing: 22) {
                // $1.5x Rev Share badge
                Text(bounty.revShare)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(Color(red: 1.0, green: 0.88, blue: 0.18))
                    )
                // Black Holes label
                Text("Black Holes")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.33, green: 0.30, blue: 0.23))
                    .padding(.top, 1)
                // Main bounty question
                Text(bounty.question)
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.black)
                    .fixedSize(horizontal: false, vertical: true)
                // Description
                Text("Some text here explaining the bountySome text here explaining the bountySome text here explaining the bountySo")
                    .font(.system(size: 15, weight: .regular, design: .rounded))
                    .foregroundStyle(Color(red: 0.35, green: 0.32, blue: 0.22).opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)

                // Stat cards
                VStack(spacing: 13) {
                    HStack {
                        Text("30% of people don’t understand this concept")
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(.black)
                            .padding(.vertical, 13)
                            .padding(.horizontal, 15)
                        Spacer()
                    }
                    .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color(red: 0.95, green: 0.94, blue: 0.91)))
                    HStack {
                        Text("Only 5 people have claimed this bounty")
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(.black)
                            .padding(.vertical, 13)
                            .padding(.horizontal, 15)
                        Spacer()
                    }
                    .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color(red: 0.95, green: 0.94, blue: 0.91)))
                }
                .padding(.top, 2)

                // Claim Bounty button
                Button {
                    onDismiss()
                } label: {
                    Text("Claim Bounty")
                        .font(.system(size: 19, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 17)
                        .background(
                            RoundedRectangle(cornerRadius: 15, style: .continuous)
                                .fill(Color(red: 0.13, green: 0.12, blue: 0.09))
                        )
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
            .padding(.all, 25)
            .background(
                RoundedRectangle(cornerRadius: 35, style: .continuous)
                    .fill(.white)
                    .shadow(color: Color.black.opacity(0.08), radius: 28, y: 8)
            )
            .padding(.horizontal, 18)
            .padding(.bottom, 34)
            .padding(.top, 2)

            Spacer(minLength: 0)
        }
        .background(Color(red: 0.97, green: 0.96, blue: 0.94).ignoresSafeArea())
    }

    /*
    private let darkText = Color(red: 0.20, green: 0.18, blue: 0.15)
    private let topicColor = Color(red: 0.35, green: 0.32, blue: 0.22)

    var body: some View {
        VStack(spacing: 0) {
            headerView

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // White card
                    VStack(alignment: .leading, spacing: 16) {
                        Text(bounty.revShare)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color(red: 1.0, green: 0.92, blue: 0.35))
                            }

                        Text(bounty.topic)
                            .font(.system(size: 15, weight: .semibold, design: .rounded))
                            .foregroundStyle(topicColor)

                        Text(bounty.question)
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(darkText)

                        Text(bounty.description ?? "Some text here explaining the bounty.")
                            .font(.system(size: 15, weight: .regular, design: .rounded))
                            .foregroundStyle(.secondary)

                        Text(bounty.struggleStat ?? "30% Users are struggling with XYZ")
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundStyle(darkText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color(red: 0.94, green: 0.94, blue: 0.94))
                            }

                        Button {
                            onDismiss()
                        } label: {
                            Text("Claim Bounty")
                                .font(.system(size: 17, weight: .semibold, design: .rounded))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .fill(Color(red: 0.12, green: 0.12, blue: 0.10))
                                }
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(24)
                    .background {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(.white)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(Color(red: 0.92, green: 0.91, blue: 0.89))
        }
    }

    private var headerView: some View {
        HStack(spacing: 10) {
            Image("Logo")
                .resizable()
                .scaledToFit()
                .frame(height: 32)

            Text("Spool")
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(Color(red: 0.85, green: 0.55, blue: 0.15))

            Spacer()

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Color(red: 0.92, green: 0.91, blue: 0.89))
    }
    */
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
            AsyncImage(url: URL(string: video.thumbnailURL)) { phase in
                switch phase {
                case .empty:
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color(red: 0.85, green: 0.75, blue: 0.65))
                        .overlay {
                            ProgressView()
                                .tint(.white.opacity(0.6))
                        }
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                case .failure:
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color(red: 0.85, green: 0.75, blue: 0.65))
                        .overlay {
                            Image(systemName: "play.fill")
                                .font(.system(size: 24))
                                .foregroundStyle(.white.opacity(0.6))
                        }
                @unknown default:
                    EmptyView()
                }
            }
            .frame(width: 80, height: 80)

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
    @Published var isPollingForMore = false

    private let topicSlug: String
    private let username: String
    private var currentCursor = 0
    private var isPreloading = false
    private var pollTask: Task<Void, Never>?

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

            // Check for API error
            if let error = response.error {
                print("API Error: \(error.code ?? "unknown") - \(error.message ?? "no message")")
                return
            }

            if let item = response.item {
                items = [item]
                currentCursor = response.cursor ?? 0
                hasNext = response.hasNext
                hasPrev = response.hasPrev
            } else {
                print("No items in feed for topic: \(topicSlug)")
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

        // Start polling when at the very end with no more items
        if index == items.count - 1 && !hasNext && !items.isEmpty {
            startPollingForMore()
        } else {
            stopPollingForMore()
        }
    }

    func startPollingForMore() {
        guard pollTask == nil else { return }
        isPollingForMore = true

        pollTask = Task { @MainActor in
            var isFirstPoll = true
            while !Task.isCancelled {
                if !isFirstPoll {
                    try? await Task.sleep(nanoseconds: 10_000_000_000) // 10 seconds
                }
                isFirstPoll = false
                guard !Task.isCancelled else { break }

                let response: FeedResponse
                do {
                    response = try await FeedService.shared.fetchNextItem(
                        topicSlug: topicSlug,
                        username: username,
                        cursor: items.count
                    )
                } catch {
                    continue
                }

                if let item = response.item {
                    let existingIds = Set(items.compactMap { feedItemId($0) })
                    if !existingIds.contains(feedItemId(item)) {
                        items.append(item)
                        hasNext = response.hasNext
                        if !response.hasNext {
                            continue // Keep polling for more
                        }
                    }
                    stopPollingForMore()
                    break
                }
            }
        }
    }

    func stopPollingForMore() {
        pollTask?.cancel()
        pollTask = nil
        isPollingForMore = false
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
    @State private var showDeepDive = false
    @State private var understoodItems: Set<String> = []
    @State private var bookmarkedItems: Set<String> = []

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
            if viewModel.items.isEmpty && viewModel.isLoading {
                // Initial loading - show centered spinner
                Color.black.ignoresSafeArea()
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.2)
            }

            if !viewModel.items.isEmpty {
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

                        if !viewModel.hasNext && !viewModel.items.isEmpty {
                            EndOfFeedCard(isPolling: viewModel.isPollingForMore)
                                .containerRelativeFrame(.vertical)
                                .id("end-of-feed")
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
                    }
                }
                .onChange(of: viewModel.items.count) { _, count in
                    // Set initial current item when items load
                    if currentItemID == nil, count > 0, let firstItem = viewModel.items.first {
                        currentItemID = feedItemId(firstItem)
                    }
                }
                .onDisappear {
                    viewModel.stopPollingForMore()
                }
            }

            // Fixed top gradient scrim
            VStack {
                LinearGradient(
                    colors: [.black.opacity(0.5), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 100)
                .ignoresSafeArea(edges: .top)

                Spacer()
            }
            .allowsHitTesting(false)

            // Fixed header + bottom caption + action bar
            VStack(spacing: 0) {
                // Header
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

                        // Subtle loading indicator in top right when preloading
                        if viewModel.isLoading {
                            ProgressView()
                                .tint(.white.opacity(0.6))
                                .scaleEffect(0.8)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.top, 12)

                Spacer()

                // Bottom section: progress bar + action bar
                HStack(alignment: .bottom, spacing: 0) {
                    // Progress bar (left side, takes remaining space)
                    if currentItem != nil {
                        bottomCaptionView(for: currentItem!)
                            .animation(.easeInOut(duration: 0.3), value: currentItemID)
                    }

                    Spacer()

                    // TikTok-style action bar (right side) - hide on quiz page
                    if let itemId = currentItemID, let item = currentItem, case .reel = item {
                        actionBar(for: itemId)
                            .padding(.trailing, 16)
                            .padding(.bottom, 32)
                    }
                }
            }

            // Deep Dive bottom sheet overlay
            if showDeepDive {
                deepDiveOverlay
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

    // MARK: - Action Bar
    @ViewBuilder
    private func actionBar(for itemId: String) -> some View {
        let isUnderstood = understoodItems.contains(itemId)
        let isBookmarked = bookmarkedItems.contains(itemId)

        VStack(spacing: 20) {
            // "I get it" button
            ActionBarButton(
                icon: isUnderstood ? "checkmark.circle.fill" : "brain.head.profile",
                label: "Got it",
                isActive: isUnderstood
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    if isUnderstood {
                        understoodItems.remove(itemId)
                    } else {
                        understoodItems.insert(itemId)
                    }
                }
            }

            // Bookmark button
            ActionBarButton(
                icon: isBookmarked ? "bookmark.fill" : "bookmark",
                label: "Save",
                isActive: isBookmarked
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    if isBookmarked {
                        bookmarkedItems.remove(itemId)
                    } else {
                        bookmarkedItems.insert(itemId)
                    }
                }
            }

            // Deep Dive button (special styling)
            Button {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                    showDeepDive = true
                }
            } label: {
                VStack(spacing: 4) {
                    ZStack {
                        Circle()
                            .fill(Color(red: 0.95, green: 0.75, blue: 0.20).opacity(0.2))
                            .frame(width: 48, height: 48)

                        Image(systemName: "sparkles")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(Color(red: 0.95, green: 0.75, blue: 0.20))
                    }

                    Text("Deep Dive")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
        }
    }

    // MARK: - Deep Dive Overlay
    @ViewBuilder
    private var deepDiveOverlay: some View {
        ZStack {
            // Dimmed background
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        showDeepDive = false
                    }
                }

            // Bottom sheet
            VStack(spacing: 0) {
                Spacer()

                VStack(spacing: 0) {
                    // Handle
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.white.opacity(0.3))
                        .frame(width: 36, height: 4)
                        .padding(.top, 12)
                        .padding(.bottom, 20)

                    // Header
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Deep Dive")
                                .font(.system(size: 22, weight: .bold, design: .rounded))
                                .foregroundStyle(.white)

                            if let item = currentItem, case .reel(let reel) = item {
                                Text(reel.conceptName)
                                    .font(.system(size: 15, weight: .medium, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.6))
                            }
                        }
                        Spacer()

                        Button {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                showDeepDive = false
                            }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 28))
                                .foregroundStyle(.white.opacity(0.5))
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)

                    // YouTube video cards (topic-specific)
                    VStack(spacing: 12) {
                        ForEach(deepDiveCards(for: topic.slug)) { card in
                            DeepDiveCard(
                                title: card.title,
                                channel: card.channel,
                                duration: card.duration,
                                thumbnailURL: card.thumbnailURL
                            )
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
                }
                .background(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color(red: 0.15, green: 0.15, blue: 0.17))
                )
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    @ViewBuilder
    private func bottomCaptionView(for item: FeedItem) -> some View {
        EmptyView()
    }

    private func feedItemId(_ item: FeedItem) -> String {
        switch item {
        case .reel(let reel): return reel.id
        case .quiz(let quiz): return quiz.id
        }
    }
}

// MARK: - Action Bar Button

struct ActionBarButton: View {
    let icon: String
    let label: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(isActive ? Color(red: 0.95, green: 0.75, blue: 0.20) : .white)
                    .shadow(color: .black.opacity(0.5), radius: 4, y: 2)

                Text(label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.8))
            }
        }
        .scaleEffect(isActive ? 1.1 : 1.0)
    }
}

// MARK: - Deep Dive Card Data

private struct DeepDiveCardData: Identifiable {
    var id: String { title }
    let title: String
    let channel: String
    let duration: String
    let thumbnailURL: String
}

private func deepDiveCards(for topicSlug: String) -> [DeepDiveCardData] {
    switch topicSlug {
    case "black-holes":
        return [
            DeepDiveCardData(
                title: "What Happens Inside a Black Hole?",
                channel: "Veritasium",
                duration: "18 min",
                thumbnailURL: "https://i.ytimg.com/vi/QqsLTNkzvaY/hqdefault.jpg"
            ),
            DeepDiveCardData(
                title: "Spaghettification Explained",
                channel: "PBS Space Time",
                duration: "12 min",
                thumbnailURL: "https://i.ytimg.com/vi/h1iJXOUMJpg/hqdefault.jpg"
            ),
            DeepDiveCardData(
                title: "Journey to the Event Horizon",
                channel: "Kurzgesagt",
                duration: "9 min",
                thumbnailURL: "https://i.ytimg.com/vi/ulCdoCfw-bY/hqdefault.jpg"
            ),
        ]
    case "ancient-history":
        return [
            DeepDiveCardData(
                title: "The Fall of Rome",
                channel: "Historia Civilis",
                duration: "15 min",
                thumbnailURL: "https://i.ytimg.com/vi/3szfK1I7bgg/hqdefault.jpg"
            ),
            DeepDiveCardData(
                title: "Ancient Egypt: Mysteries of the Pharaohs",
                channel: "CrashCourse",
                duration: "11 min",
                thumbnailURL: "https://i.ytimg.com/vi/Z3Wvw6BivVI/hqdefault.jpg"
            ),
            DeepDiveCardData(
                title: "The Bronze Age Collapse",
                channel: "Fall of Civilizations",
                duration: "22 min",
                thumbnailURL: "https://i.ytimg.com/vi/BxqpdToY0Hg/hqdefault.jpg"
            ),
        ]
    case "linear-algebra":
        return [
            DeepDiveCardData(
                title: "Essence of Linear Algebra",
                channel: "3Blue1Brown",
                duration: "10 min",
                thumbnailURL: "https://i.ytimg.com/vi/fNk_zzaMoSs/hqdefault.jpg"
            ),
            DeepDiveCardData(
                title: "Matrix Multiplication Visualized",
                channel: "Zach Star",
                duration: "8 min",
                thumbnailURL: "https://i.ytimg.com/vi/2spTnAiQg4M/hqdefault.jpg"
            ),
            DeepDiveCardData(
                title: "Eigenvectors and Eigenvalues",
                channel: "Khan Academy",
                duration: "12 min",
                thumbnailURL: "https://i.ytimg.com/vi/PhfbEr2btGQ/hqdefault.jpg"
            ),
        ]
    default:
        return []
    }
}

// MARK: - Deep Dive Card

struct DeepDiveCard: View {
    let title: String
    let channel: String
    let duration: String
    let thumbnailURL: String

    var body: some View {
        Button {
            // TODO: Open YouTube link
        } label: {
            HStack(spacing: 14) {
                // Thumbnail from URL
                AsyncImage(url: URL(string: thumbnailURL)) { phase in
                    switch phase {
                    case .empty:
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color(red: 0.2, green: 0.2, blue: 0.25))
                            .overlay {
                                ProgressView()
                                    .tint(.white.opacity(0.5))
                            }
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    case .failure:
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color(red: 0.2, green: 0.2, blue: 0.25))
                            .overlay {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 24))
                                    .foregroundStyle(.white.opacity(0.5))
                            }
                    @unknown default:
                        EmptyView()
                    }
                }
                .frame(width: 120, height: 68)

                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 8) {
                        Text(channel)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.5))

                        Text("•")
                            .foregroundStyle(.white.opacity(0.3))

                        Text(duration)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.3))
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
        }
    }
}

// MARK: - End of Feed Card

struct EndOfFeedCard: View {
    let isPolling: Bool

    var body: some View {
        VStack(spacing: 16) {
            if isPolling {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.2)
                Text("Generating more content…")
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.8))
            } else {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 48))
                    .foregroundStyle(.white.opacity(0.6))
                Text("You've reached the end")
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.8))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
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
    @State private var userPaused = false

    private var shouldPlay: Bool {
        isCurrentItem && !userPaused
    }

    var body: some View {
        ZStack {
            if reel.hasVideo, let videoUrlString = reel.videoUrl, let url = URL(string: videoUrlString) {
                SingletonPlayerView(url: url, viewId: reel.id, isPlaying: .constant(shouldPlay))
                    .ignoresSafeArea()
                    .onTapGesture {
                        userPaused.toggle()
                    }

                if !shouldPlay && isCurrentItem {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(.white.opacity(0.7))
                        .transition(.opacity)
                }
            } else if reel.hasAudio, let audioUrlString = reel.audioUrl, let url = URL(string: audioUrlString) {
                AudioOnlyReelView(
                    reel: reel,
                    audioUrl: url,
                    isCurrentItem: isCurrentItem,
                    shouldPlay: shouldPlay,
                    onTap: { userPaused.toggle() }
                )
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
            if isCurrent {
                userPaused = false  // Reset pause state when becoming current
            }
        }
    }
}

// MARK: - Audio-Only Reel View (gradient + captions + audio)

private let audioReelGradient = LinearGradient(
    colors: [
        Color(red: 0.102, green: 0.102, blue: 0.180),  // #1a1a2e
        Color(red: 0.086, green: 0.129, blue: 0.243),    // #16213e
    ],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
)

struct AudioOnlyReelView: View {
    let reel: ReelItem
    let audioUrl: URL
    let isCurrentItem: Bool
    let shouldPlay: Bool
    let onTap: () -> Void

    @ObservedObject private var audioManager = AudioPlayerManager.shared

    var body: some View {
        ZStack {
            audioReelGradient
                .ignoresSafeArea()

            if let captions = reel.captions, !captions.isEmpty {
                CaptionOverlayView(
                    captions: captions,
                    currentTime: audioManager.isActiveView(reel.id) ? audioManager.currentPlaybackTime : 0
                )
            }

            if !shouldPlay && isCurrentItem {
                Image(systemName: "pause.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .onTapGesture {
            onTap()
        }
        .onChange(of: isCurrentItem) { _, isCurrent in
            if isCurrent && shouldPlay {
                AudioPlayerManager.shared.play(url: audioUrl, viewId: reel.id)
            } else if !isCurrent {
                AudioPlayerManager.shared.stop(viewId: reel.id)
            }
        }
        .onChange(of: shouldPlay) { _, play in
            guard isCurrentItem else { return }
            if play {
                AudioPlayerManager.shared.play(url: audioUrl, viewId: reel.id)
            } else {
                AudioPlayerManager.shared.pause(viewId: reel.id)
            }
        }
        .onAppear {
            if isCurrentItem && shouldPlay {
                AudioPlayerManager.shared.play(url: audioUrl, viewId: reel.id)
            }
        }
        .onDisappear {
            if AudioPlayerManager.shared.isActiveView(reel.id) {
                AudioPlayerManager.shared.stop(viewId: reel.id)
            }
        }
    }
}

struct CaptionOverlayView: View {
    let captions: [CaptionWord]
    let currentTime: Double

    private let wordsPerLine = 4

    private var visibleWords: [(CaptionWord, Bool)] {
        captions.map { word in
            let isActive = currentTime >= word.startTime && currentTime < word.endTime
            return (word, isActive)
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            Spacer()
                .frame(minHeight: 200)

            FlowLayout(spacing: 8) {
                ForEach(Array(visibleWords.enumerated()), id: \.offset) { _, item in
                    Text(item.0.word)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .opacity(item.1 ? 1.0 : 0.4)
                }
            }
            .frame(maxWidth: 340)
            .frame(maxWidth: .infinity)

            Spacer()
                .frame(height: 150)
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, subview) in subviews.enumerated() {
            subview.place(
                at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y),
                anchor: .topLeading,
                proposal: .unspecified
            )
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            lineHeight = max(lineHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + lineHeight), positions)
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

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.ignoresSafeArea()

                VStack(spacing: 0) {
                    Spacer()

                    // Question - compact, max 2 lines
                    Text(quiz.question)
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 32)

                    // Answer cards - tighter
                    VStack(spacing: 10) {
                        ForEach(Array(quiz.answerChoices.enumerated()), id: \.offset) { _, answer in
                            ProveItAnswerCard(
                                answer: answer,
                                isCorrect: answer == quiz.correctAnswer,
                                isSelected: selectedAnswer == answer,
                                showResult: showResult
                            ) {
                                handleAnswerTap(answer)
                            }
                        }
                    }
                    .padding(.horizontal, 28)

                    Spacer()
                    Spacer()
                }

                ConfettiView(isEmitting: showConfetti, origin: confettiOrigin)
                    .allowsHitTesting(false)
            }
        }
    }

    private func handleAnswerTap(_ answer: String) {
        guard !showResult else { return }

        selectedAnswer = answer

        withAnimation(.easeInOut(duration: 0.3)) {
            showResult = true
        }

        if answer == quiz.correctAnswer {
            // Trigger confetti from center of screen
            confettiOrigin = CGPoint(x: UIScreen.main.bounds.midX, y: UIScreen.main.bounds.midY)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                showConfetti = true
            }
        }
    }
}

// MARK: - Prove It Answer Card

struct ProveItAnswerCard: View {
    let answer: String
    let isCorrect: Bool
    let isSelected: Bool
    let showResult: Bool
    let onTap: () -> Void

    @State private var shakeAttempts: CGFloat = 0
    @State private var isPulsing = false

    private let correctGreen = Color(red: 0.2, green: 0.55, blue: 0.3)
    private let wrongRed = Color(red: 0.6, green: 0.2, blue: 0.2)

    var body: some View {
        Button {
            if showResult { return }
            onTap()

            if !isCorrect {
                withAnimation(.linear(duration: 0.5)) {
                    shakeAttempts += 1
                }
                isPulsing = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    withAnimation(.easeOut(duration: 0.3)) {
                        isPulsing = false
                    }
                }
            }
        } label: {
            HStack(spacing: 12) {
                if showResult && (isCorrect || isSelected) {
                    Image(systemName: isCorrect ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(isCorrect ? Color(red: 0.4, green: 0.85, blue: 0.5) : Color(red: 0.9, green: 0.45, blue: 0.45))
                        .transition(.scale.combined(with: .opacity))
                }

                Text(answer)
                    .font(.system(size: 16, weight: .medium, design: .rounded))
                    .foregroundStyle(textColor)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                Spacer()
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(backgroundColor)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(borderColor, lineWidth: 1)
                    }
            }
        }
        .buttonStyle(.plain)
        .modifier(ShakeEffect(animatableData: shakeAttempts))
        .disabled(showResult)
    }

    private var textColor: Color {
        if !showResult { return .white }
        if isCorrect { return Color(red: 0.5, green: 0.9, blue: 0.6) }
        if isSelected { return Color(red: 0.95, green: 0.55, blue: 0.5) }
        return .white.opacity(0.35)
    }

    private var backgroundColor: Color {
        if isPulsing && isSelected {
            return wrongRed.opacity(0.6)
        }
        if !showResult { return .white.opacity(0.08) }
        if isCorrect { return correctGreen.opacity(0.35) }
        if isSelected { return wrongRed.opacity(0.35) }
        return .white.opacity(0.05)
    }

    private var borderColor: Color {
        if isPulsing && isSelected {
            return Color.red.opacity(0.6)
        }
        if !showResult { return .white.opacity(0.1) }
        if isCorrect { return correctGreen.opacity(0.6) }
        if isSelected { return wrongRed.opacity(0.5) }
        return .clear
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
            playerLayer.player = AudioPlayerManager.shared.getPlayer()
        } else {
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

