import { mutation } from './_generated/server';
import { v } from 'convex/values';

export const createRun = mutation({
	args: {
		sessionId: v.id('sessions'),
		query: v.string(),
		pipeline: v.union(v.literal('no_context'), v.literal('full_context'), v.literal('rag')),
		modelFamily: v.string(),
		modelName: v.string(),
		answer: v.string(),
		confidence: v.number(),
		hallucinationCount: v.number(),
		hallucinations: v.array(
			v.object({
				claim: v.string(),
				reason: v.string()
			})
		),
		sentences: v.array(
			v.object({
				text: v.string(),
				grounded: v.boolean(),
				score: v.number(),
				reason: v.string()
			})
		),
		citations: v.array(
			v.object({
				chunkOrder: v.number(),
				text: v.string()
			})
		),
		positionBins: v.array(
			v.object({
				bin: v.number(),
				rangeLabel: v.string(),
				hits: v.number()
			})
		),
		contextChars: v.number(),
		contextChunks: v.number(),
		contextCoverage: v.number(),
		noiseInjected: v.boolean(),
		latencyMs: v.number()
	},
	handler: async (ctx, args) => {
		return ctx.db.insert('runs', {
			...args,
			createdAt: Date.now()
		});
	}
});
