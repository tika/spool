//
//  ContentView.swift
//  Spool
//
//  Created by Tika on 22/02/2026.
//

import SwiftUI

// MARK: - Models

struct Topic: Identifiable {
    let id = UUID()
    let title: String
    let subtitle: String
    let gradient: [Color]
}

// MARK: - Content View

struct ContentView: View {
    @State private var expandedTopicID: UUID?

    private let topics: [Topic] = [
        Topic(
            title: "Differential Equations",
            subtitle: "15 concepts discovered",
            gradient: [
                Color(red: 0.85, green: 0.78, blue: 0.65),
                Color(red: 0.92, green: 0.86, blue: 0.72),
                Color(red: 0.95, green: 0.90, blue: 0.75),
            ]
        ),
        Topic(
            title: "Black Holes",
            subtitle: "Last viewed 24h ago",
            gradient: [
                Color(red: 0.38, green: 0.52, blue: 0.35),
                Color(red: 0.55, green: 0.58, blue: 0.30),
            ]
        ),
        Topic(
            title: "Black Holes",
            subtitle: "Last viewed 24h ago",
            gradient: [
                Color(red: 0.72, green: 0.80, blue: 0.78),
                Color(red: 0.78, green: 0.82, blue: 0.76),
            ]
        ),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerView

                ForEach(topics) { topic in
                    let isExpanded = expandedTopicID == topic.id

                    TopicCardView(topic: topic, isExpanded: isExpanded)
                        .onTapGesture {
                            withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                                expandedTopicID = isExpanded ? nil : topic.id
                            }
                        }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .background(Color(red: 0.97, green: 0.96, blue: 0.94))
        .onAppear {
            expandedTopicID = topics.first?.id
        }
    }
}

// MARK: - Header

private extension ContentView {
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
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Topic Card View

struct TopicCardView: View {
    let topic: Topic
    let isExpanded: Bool

    private var cornerRadius: CGFloat { isExpanded ? 24 : 18 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if isExpanded {
                Spacer(minLength: 0)
            }

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

// MARK: - Preview

#Preview {
    ContentView()
}
