//
//  ContentView.swift
//  Spool
//
//  Created by Tika on 22/02/2026.
//

import AVFoundation
import Combine
import SwiftUI

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

// MARK: - Content View

struct ContentView: View {
    @State private var expandedTopicID: UUID?
    @State private var showingAddSheet = false
    @State private var visibleTopics: [Topic] = []
    @State private var loadingTopic: Topic?
    @State private var learningTopic: Topic?

    private let currentUser = AppUser.defaultUser

    private static let allTopics: [Topic] = [
        Topic(
            title: "Black Holes",
            slug: "black-holes",
            subtitle: "5 concepts with videos",
            gradient: [
                Color(red: 0.15, green: 0.15, blue: 0.25),
                Color(red: 0.25, green: 0.20, blue: 0.35),
            ]
        ),
        Topic(
            title: "Linear Algebra",
            slug: "linear-algebra",
            subtitle: "Vectors and matrices",
            gradient: [
                Color(red: 0.38, green: 0.52, blue: 0.35),
                Color(red: 0.55, green: 0.58, blue: 0.30),
            ]
        ),
        Topic(
            title: "Ancient History",
            slug: "ancient-history",
            subtitle: "Journey through time",
            gradient: [
                Color(red: 0.85, green: 0.78, blue: 0.65),
                Color(red: 0.92, green: 0.86, blue: 0.72),
            ]
        ),
        Topic(
            title: "Matrices",
            slug: "matricies",
            subtitle: "Matrix operations",
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
        ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    headerView

                    ForEach(visibleTopics) { topic in
                        let isExpanded = expandedTopicID == topic.id

                        TopicCardView(
                            topic: topic,
                            isExpanded: isExpanded,
                            onStartLearning: {
                                withAnimation(.spring(response: 0.5, dampingFraction: 0.88)) {
                                    learningTopic = topic
                                }
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
            }
            .background(Color(red: 0.97, green: 0.96, blue: 0.94))

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
        .onAppear {
            let first = Self.allTopics[0]
            visibleTopics = [first]
            expandedTopicID = first.id
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
}

// MARK: - Header & Add Button

private extension ContentView {
    var addButton: some View {
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

    var headerView: some View {
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

            Button {
            } label: {
                Text("bount")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.40, green: 0.38, blue: 0.32))
            }

            Button {
            } label: {
                Text("your videos")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.40, green: 0.38, blue: 0.32))
            }
        }
        .padding(.vertical, 4)
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
                            FeedItemPageView(item: item)
                                .containerRelativeFrame(.vertical)
                                .id(feedItemId(item))
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

    var body: some View {
        switch item {
        case .reel(let reel):
            ReelPageView(reel: reel)
        case .quiz(let quiz):
            QuizPageView(quiz: quiz)
        }
    }
}

// MARK: - Reel Page View

struct ReelPageView: View {
    let reel: ReelItem
    @State private var isPlaying = true
    @State private var restartToken = UUID()

    var body: some View {
        ZStack {
            if let videoUrlString = reel.videoUrl, let url = URL(string: videoUrlString) {
                LoopingPlayerView(url: url, isPlaying: $isPlaying, restartToken: restartToken)
                    .ignoresSafeArea()
                    .onTapGesture {
                        isPlaying.toggle()
                    }

                if !isPlaying {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(.white.opacity(0.7))
                        .transition(.opacity)
                }
            } else {
                // No video available - show placeholder
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
        .onAppear {
            isPlaying = true
            restartToken = UUID()
        }
        .onDisappear {
            isPlaying = false
        }   
    }
}

// MARK: - Quiz Page View

struct QuizPageView: View {
    let quiz: QuizItem
    @State private var selectedAnswer: String?
    @State private var showResult = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text(quiz.question)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            VStack(spacing: 12) {
                ForEach(quiz.answerChoices, id: \.self) { answer in
                    Button {
                        selectedAnswer = answer
                        showResult = true
                    } label: {
                        Text(answer)
                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                            .foregroundStyle(answerColor(for: answer))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(answerBackground(for: answer))
                            }
                    }
                    .disabled(showResult)
                }
            }
            .padding(.horizontal, 24)

            Spacer()
        }
    }

    private func answerColor(for answer: String) -> Color {
        guard showResult else { return .white }
        if answer == quiz.correctAnswer {
            return .white
        }
        if answer == selectedAnswer {
            return .white
        }
        return .white.opacity(0.5)
    }

    private func answerBackground(for answer: String) -> Color {
        guard showResult else { return .white.opacity(0.15) }
        if answer == quiz.correctAnswer {
            return .green.opacity(0.6)
        }
        if answer == selectedAnswer {
            return .red.opacity(0.6)
        }
        return .white.opacity(0.1)
    }
}


// MARK: - Looping Video Player

struct LoopingPlayerView: UIViewRepresentable {
    let url: URL
    @Binding var isPlaying: Bool
    let restartToken: UUID

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> LoopingPlayerUIView {
        let view = LoopingPlayerUIView(url: url)
        context.coordinator.lastToken = restartToken
        return view
    }

    func updateUIView(_ uiView: LoopingPlayerUIView, context: Context) {
        if restartToken != context.coordinator.lastToken {
            context.coordinator.lastToken = restartToken
            uiView.seekToBeginning()
        }
        if isPlaying {
            uiView.play()
        } else {
            uiView.pause()
        }
    }

    class Coordinator {
        var lastToken = UUID()
    }
}

final class LoopingPlayerUIView: UIView {
    private var playerLayer = AVPlayerLayer()
    private var queuePlayer: AVQueuePlayer?
    private var playerLooper: AVPlayerLooper?

    init(url: URL) {
        super.init(frame: .zero)

        let item = AVPlayerItem(url: url)
        let player = AVQueuePlayer(items: [item])
        playerLooper = AVPlayerLooper(player: player, templateItem: item)
        player.isMuted = false

        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)

        player.play()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }

    func play() {
        playerLayer.player?.play()
    }

    func pause() {
        playerLayer.player?.pause()
    }

    func seekToBeginning() {
        playerLayer.player?.seek(to: .zero)
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
