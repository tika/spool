import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  smallint,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// USERS
// ============================================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  watched: many(userWatched),
}));

// ============================================================================
// TOPICS
// ============================================================================

export const topics = pgTable("topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 50 }).notNull().default("generating"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const topicsRelations = relations(topics, ({ many }) => ({
  concepts: many(concepts),
  quizzes: many(quizzes),
}));

// ============================================================================
// CONCEPTS
// ============================================================================

export const concepts = pgTable("concepts", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topics.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  difficulty: smallint("difficulty").notNull().default(1),
  orderIndex: smallint("order_index").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conceptsRelations = relations(concepts, ({ one, many }) => ({
  topic: one(topics, {
    fields: [concepts.topicId],
    references: [topics.id],
  }),
  reels: many(reels),
  prerequisites: many(conceptPrerequisites, { relationName: "concept" }),
  dependents: many(conceptPrerequisites, { relationName: "prerequisite" }),
  quizConcepts: many(quizConcepts),
}));

// ============================================================================
// REELS (Videos)
// ============================================================================

export const reels = pgTable("reels", {
  id: uuid("id").primaryKey().defaultRandom(),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => concepts.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  transcript: text("transcript"),
  videoUrl: text("video_url"),
  audioUrl: text("audio_url"),
  captions: jsonb("captions").$type<Array<{ word: string; startTime: number; endTime: number }>>(),
  thumbnailUrl: text("thumbnail_url"),
  durationSeconds: smallint("duration_seconds"),
  source: varchar("source", { length: 100 }),
  tone: varchar("tone", { length: 100 }),
  point: text("point"),
  qualityScore: smallint("quality_score").default(0),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reelsRelations = relations(reels, ({ one, many }) => ({
  concept: one(concepts, {
    fields: [reels.conceptId],
    references: [concepts.id],
  }),
  watchedBy: many(userWatched),
}));

// ============================================================================
// CONCEPT PREREQUISITES (self-referencing join table for DAG)
// ============================================================================

export const conceptPrerequisites = pgTable(
  "concept_prerequisites",
  {
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    prerequisiteId: uuid("prerequisite_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.conceptId, table.prerequisiteId] })]
);

export const conceptPrerequisitesRelations = relations(
  conceptPrerequisites,
  ({ one }) => ({
    concept: one(concepts, {
      fields: [conceptPrerequisites.conceptId],
      references: [concepts.id],
      relationName: "concept",
    }),
    prerequisite: one(concepts, {
      fields: [conceptPrerequisites.prerequisiteId],
      references: [concepts.id],
      relationName: "prerequisite",
    }),
  })
);

// ============================================================================
// QUIZZES
// ============================================================================

export const quizzes = pgTable("quizzes", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id")
    .notNull()
    .references(() => topics.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  correctAnswer: varchar("correct_answer", { length: 500 }).notNull(),
  answerChoices: jsonb("answer_choices").$type<string[]>().notNull(),
  orderIndex: smallint("order_index").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  topic: one(topics, {
    fields: [quizzes.topicId],
    references: [topics.id],
  }),
  quizConcepts: many(quizConcepts),
}));

// ============================================================================
// QUIZ CONCEPTS (junction table: quiz covers 3-5 concepts)
// ============================================================================

export const quizConcepts = pgTable(
  "quiz_concepts",
  {
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.quizId, table.conceptId] })]
);

export const quizConceptsRelations = relations(
  quizConcepts,
  ({ one }) => ({
    quiz: one(quizzes, {
      fields: [quizConcepts.quizId],
      references: [quizzes.id],
    }),
    concept: one(concepts, {
      fields: [quizConcepts.conceptId],
      references: [concepts.id],
    }),
  })
);

// ============================================================================
// USER WATCHED (tracking watch history)
// ============================================================================

export const userWatched = pgTable(
  "user_watched",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id")
      .notNull()
      .references(() => reels.id, { onDelete: "cascade" }),
    watchedAt: timestamp("watched_at").notNull().defaultNow(),
    completed: boolean("completed").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.userId, table.reelId] })]
);

export const userWatchedRelations = relations(userWatched, ({ one }) => ({
  user: one(users, {
    fields: [userWatched.userId],
    references: [users.id],
  }),
  reel: one(reels, {
    fields: [userWatched.reelId],
    references: [reels.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Topic = typeof topics.$inferSelect;
export type NewTopic = typeof topics.$inferInsert;

export type Concept = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;

export type Reel = typeof reels.$inferSelect;
export type NewReel = typeof reels.$inferInsert;

export type UserWatched = typeof userWatched.$inferSelect;
export type NewUserWatched = typeof userWatched.$inferInsert;

export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
