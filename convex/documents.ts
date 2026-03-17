import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

function normalizeWhitespace(text: string) {
	return text.replace(/\s+/g, ' ').trim();
}

function tokenize(text: string) {
	return Array.from(new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []));
}

function chunkText(text: string) {
	const normalized = normalizeWhitespace(text);
	const chunks: Array<{ order: number; text: string; tokens: string[] }> = [];
	let order = 0;

	for (let index = 0; index < normalized.length; index += CHUNK_SIZE - CHUNK_OVERLAP) {
		const part = normalized.slice(index, index + CHUNK_SIZE).trim();
		if (!part) {
			continue;
		}
		chunks.push({ order, text: part, tokens: tokenize(part) });
		order += 1;
	}

	if (chunks.length === 0 && normalized) {
		chunks.push({ order: 0, text: normalized, tokens: tokenize(normalized) });
	}

	return chunks;
}

export const createSession = mutation({
	args: {
		filename: v.string(),
		text: v.string()
	},
	handler: async (ctx, args) => {
		const fullText = normalizeWhitespace(args.text);
		if (!fullText) {
			throw new Error('Document has no extractable text.');
		}

		const previewText = fullText.slice(0, 4000);
		const createdAt = Date.now();
		const sessionId = await ctx.db.insert('sessions', {
			filename: args.filename,
			previewText,
			fullText,
			createdAt
		});

		for (const chunk of chunkText(fullText)) {
			await ctx.db.insert('chunks', {
				sessionId,
				order: chunk.order,
				text: chunk.text,
				tokens: chunk.tokens
			});
		}

		return {
			sessionId,
			filename: args.filename,
			previewText,
			createdAt
		};
	}
});

export const getSession = query({
	args: { sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		return ctx.db.get(args.sessionId);
	}
});

export const getChunks = query({
	args: { sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		return ctx.db
			.query('chunks')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.collect();
	}
});

export const getRuns = query({
	args: { sessionId: v.id('sessions') },
	handler: async (ctx, args) => {
		return ctx.db
			.query('runs')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('desc')
			.collect();
	}
});

export const getAllRuns = query({
	args: {},
	handler: async (ctx) => {
		return ctx.db.query('runs').order('desc').take(500);
	}
});

export const clearAllData = mutation({
	args: {},
	handler: async (ctx) => {
		const runs = await ctx.db.query('runs').collect();
		for (const run of runs) {
			await ctx.db.delete(run._id);
		}

		const chunks = await ctx.db.query('chunks').collect();
		for (const chunk of chunks) {
			await ctx.db.delete(chunk._id);
		}

		const sessions = await ctx.db.query('sessions').collect();
		for (const session of sessions) {
			await ctx.db.delete(session._id);
		}

		return {
			deletedRuns: runs.length,
			deletedChunks: chunks.length,
			deletedSessions: sessions.length
		};
	}
});

export const listSessions = query({
	args: {},
	handler: async (ctx) => {
		return ctx.db.query('sessions').order('desc').take(100);
	}
});
