import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	sessions: defineTable({
		title: v.optional(v.string()),
		filename: v.string(),
		previewText: v.string(),
		fullText: v.optional(v.string()),
		fullTextCharCount: v.optional(v.number()),
		createdAt: v.number()
	}),
	chunks: defineTable({
		sessionId: v.id('sessions'),
		order: v.number(),
		text: v.string(),
		tokens: v.array(v.string())
	}).index('by_session', ['sessionId']),
	runs: defineTable({
		sessionId: v.id('sessions'),
		query: v.string(),
		pipeline: v.union(
			v.literal('baseline'),
			v.literal('no_context'),
			v.literal('full_context'),
			v.literal('rag')
		),
		modelFamily: v.optional(v.string()),
		modelName: v.optional(v.string()),
		answer: v.string(),
		confidence: v.number(),
		hallucinationCount: v.number(),
		hallucinations: v.array(
			v.object({
				claim: v.string(),
				reason: v.string()
			})
		),
		sentences: v.optional(
			v.array(
				v.object({
					text: v.string(),
					grounded: v.boolean(),
					score: v.number(),
					reason: v.string()
				})
			)
		),
		citations: v.array(
			v.object({
				chunkOrder: v.number(),
				text: v.string()
			})
		),
		positionBins: v.optional(
			v.array(
				v.object({
					bin: v.number(),
					rangeLabel: v.string(),
					hits: v.number()
				})
			)
		),
		contextChars: v.optional(v.number()),
		contextChunks: v.optional(v.number()),
		contextCoverage: v.optional(v.number()),
		trustEfficiency: v.optional(v.float64()),
		noiseSlope: v.optional(v.number()),
		middleRecovery: v.optional(v.number()),
		noiseInjected: v.optional(v.boolean()),
		latencyMs: v.number(),
		createdAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_query', ['sessionId', 'query'])
});
