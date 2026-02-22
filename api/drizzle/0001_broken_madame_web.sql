CREATE TABLE "quiz_concepts" (
	"quiz_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	CONSTRAINT "quiz_concepts_quiz_id_concept_id_pk" PRIMARY KEY("quiz_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"question" text NOT NULL,
	"correct_answer" varchar(500) NOT NULL,
	"answer_choices" jsonb NOT NULL,
	"order_index" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quiz_concepts" ADD CONSTRAINT "quiz_concepts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_concepts" ADD CONSTRAINT "quiz_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;