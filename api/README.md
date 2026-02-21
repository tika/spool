The app is called Tidbit. You enter a topic (e.g. "C++") and get an infinite TikTok-style feed of short educational videos in the right order to learn it.

Three core pieces:

1. Curriculum Agent — an LLM that generates a concept graph for a topic. Concepts are nodes, prerequisite relationships are edges forming a DAG. It generates in chunks (~10-15 concepts) and extends the graph as the user progresses. A topic is never "complete."

2. Content Delivery Agent — given concepts from the curriculum agent, this scripts and generates short videos (TTS + programmatic visuals). Multiple videos can exist per concept (different approaches to explaining it). One is marked as primary for the default feed. These are all AI-generated — there's a background worker that stays ~5 concepts ahead of the user.

3. Feed — the user scrolls. The feed does a topological sort of the concept DAG, filters out what they've already watched, and returns the primary video for each next concept. Simple cursor-based: /next and /previous.

Graph schema (4 nodes, 4 edges):

Nodes:
- Topic (slug, title, description, status)
- Concept (slug, title, description, difficulty, order_hint, status)
- Reel (reel_id, title, transcript, video_url, duration, metadata like tone/difficulty/quality)
- User (username, display_name)

Edges:
- HasConcept: Topic → Concept
- Requires: Concept → Concept (the prerequisite DAG — this is the core)
- Teaches: Reel → Concept (with is_primary, relevance_score, context_description)
- Watched: User → Reel (with watched_at, duration, completed)

Vector nodes:
- ConceptEmbedding (for matching new videos to concepts)
- ReelEmbedding (for future semantic search)

The key query pattern I need to get right is the feed assembly:
1. Get all concepts for a topic (Topic→HasConcept→Concept)
2. Get what the user has watched (User→Watched→Reel→Teaches→Concept)
3. Topological sort the Requires DAG
4. Filter watched, pick primary reels
