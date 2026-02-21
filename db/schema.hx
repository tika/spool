// Start building your schema here.
//
// The schema is used to to ensure a level of type safety in your queries.
//
// The schema is made up of Node types, denoted by N::,
// and Edge types, denoted by E::
//
// Under the Node types you can define fields that
// will be stored in the database.
//
// Under the Edge types you can define what type of node
// the edge will connect to and from, and also the
// properties that you want to store on the edge.
//
// Example:
//
// N::User {
//     Name: String,
//     Label: String,
//     Age: I64,
//     IsAdmin: Boolean,
// }
//
// E::Knows {
//     From: User,
//     To: User,
//     Properties: {
//         Since: I64,
//     }
// }

N::User {
    UNIQUE INDEX username: String,
    created_at: Date,
}

E::Watched {
    From: User,
    To: Reel,
    Properties: {
        watched_at: Date,
        completed: Boolean,
    }
}

N::Reel {
    name: String,
    description: String,
    transcript: String,
    video_url: String,
    thumbnail_url: String,
    duration_seconds: U16, // in secoonds
    source: String,

    // Metadata
    tone: String,
    point: String,
    quality_score: U8, // 0-100
    created_at: Date,
}

N::Topic {
    UNIQUE INDEX slug: String,
    name: String,
    description: String,
    created_at: Date,
}

E::HasConcept {
    From: Topic,
    To: Concept,
}

E::Teaches {
    From: Reel,
    To: Concept,
    Properties: {
        is_primary: Boolean,
        relevance_score: U16,
        context_description: String, // description of the concept that the reel teaches
    }
}

N::Concept {
    UNIQUE INDEX slug: String,
    name: String,
    description: String,
    difficulty: U16, // 1-10
    order_hint: U16,
}

// Ensure this points the right way
E::Requires {
    From: Concept,
    To: Concept,
}
