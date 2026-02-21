// Start writing your queries here.
//
// You can use the schema to help you write your queries.
//
// Queries take the form:
//     QUERY {query name}({input name}: {input type}) =>
//         {variable} <- {traversal}
//         RETURN {variable}
//
// Example:
//     QUERY GetUserFriends(user_id: String) =>
//         friends <- N<User>(user_id)::Out<Knows>
//         RETURN friends
//
//
// For more information on how to write queries,
// see the documentation at https://docs.helix-db.com
// or checkout our GitHub at https://github.com/HelixDB/helix-db

QUERY CreateUser(username: String) =>
    user <- AddN<User>({
        username: username,
    })
    RETURN user

QUERY GetUser(user_id: ID) =>
    user <- N<User>(user_id)
    RETURN user

QUERY CreateTopic(name: String, description: String) =>
    topic <- AddN<Topic>({
        name: name,
        description: description,
    })
    RETURN topic

QUERY GetTopicBySlug(slug: String) =>
    topic <- N<Topic>({slug: slug})
    RETURN topic

QUERY CreateConcept(name: String, description: String, difficulty: U16, order_hint: U16) =>
    concept <- AddN<Concept>({
        name: name,
        description: description,
        difficulty: difficulty,
        order_hint: order_hint,
    })
    RETURN concept

QUERY GetConceptsByTopic(topic_id: ID) =>
    concepts <- N<Topic>(topic_id)::Out<HasConcept>
    RETURN concepts

QUERY GetConceptBySlug(slug: String) =>
    concept <- N<Concept>({slug: slug})
    RETURN concept

// Reels
QUERY CreateReel(name: String, description: String, transcript: String, video_url: String, thumbnail_url: String, duration_seconds: U16, source: String) =>
    reel <- AddN<Reel>({
        name: name,
        description: description,
        transcript: transcript,
        video_url: video_url,
        thumbnail_url: thumbnail_url,
        duration_seconds: duration_seconds,
        source: source,
    })
    RETURN reel

QUERY GetReel(reel_id: ID) =>
    reel <- N<Reel>(reel_id)
    RETURN reel

QUERY GetReelsByConcept(concept_id: ID) =>
    reels <- N<Concept>(concept_id)::In<Teaches>
    RETURN reels

QUERY GetPrimaryReelByConcept(concept_id: ID) =>
    reel <- N<Concept>(concept_id)::InE<Teaches>::WHERE(_::{is_primary}::EQ(true))::FromN
    RETURN reel

// Edges
QUERY AddHasConcept(topic_id: ID, concept_id: ID) =>
    edge <- AddE<HasConcept>::From(topic_id)::To(concept_id)
    RETURN edge

QUERY AddTeaches(reel_id: ID, concept_id: ID, is_primary: Boolean, relevance_score: U16, context_description: String) =>
    edge <- AddE<Teaches>({
        is_primary: is_primary,
        relevance_score: relevance_score,
        context_description: context_description,
    })::From(reel_id)::To(concept_id)
    RETURN edge

QUERY AddWatched(user_id: ID, reel_id: ID, watched_at: Date, completed: Boolean) =>
    edge <- AddE<Watched>({
        watched_at: watched_at,
        completed: completed,
    })::From(user_id)::To(reel_id)
    RETURN edge

QUERY AddRequires(concept_id: ID, prerequisite_concept_id: ID) =>
    edge <- AddE<Requires>::From(concept_id)::To(prerequisite_concept_id)
    RETURN edge

QUERY AddWatched(user_id: ID, reel_id: ID, watched_at: Date, completed: Boolean) =>
    edge <- AddE<Watched>({
        watched_at: watched_at,
        completed: completed,
    })::From(user_id)::To(reel_id)
    RETURN edge


// Feed

// getConceptGraph — all concepts for a topic + all Requires edges between them. This is what you topo-sort. You need both the nodes and the edges back.
QUERY GetConceptGraph(topic_id: ID) =>
    concepts <- N<Topic>(topic_id)::Out<HasConcept>
    edges <- concepts::InE<Requires>
    RETURN concepts, edges

QUERY GetWatchedReelIds(user_id: ID) =>
    reel_ids <- N<User>(user_id)::Out<Watched>
    RETURN reel_ids

QUERY GetConceptsWithPrimaryReels(topic_id: ID) =>
    concepts <- N<Topic>(topic_id)::Out<HasConcept>
    primary_reels <- concepts::InE<Teaches>::WHERE(_::{is_primary}::EQ(true))::FromN
    RETURN concepts, primary_reels

// Bg workers
QUERY GetConceptsWithoutVideos(topic_id: ID) =>
    concepts <- N<Topic>(topic_id)::Out<HasConcept>::WHERE(
        !EXISTS(_::InE<Teaches>::WHERE(_::{is_primary}::EQ(true)))
    )
    RETURN concepts

// QUERY CountWatchedConcepts(user_id: ID, topic_id: ID) =>
//     topic_concepts <- N<Topic>(topic_id)::Out<HasConcept>
//     primary_reels <- topic_concepts::InE<Teaches>::WHERE(_::{is_primary}::EQ(true))::FromN
//     count <- N<User>(user_id)::Out<Watched>::WHERE(
//         EXISTS(_::InE<Teaches>::WHERE(_::{is_primary}::EQ(true))::ToN::WHERE(_::IN(topic_concepts)))
//     )::COUNT
//     RETURN count
