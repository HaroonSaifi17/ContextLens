import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';
import { generateResearchQueries } from '$lib/server/analysis';

interface ChunkRecord {
	order: number;
	text: string;
}

interface SessionRecord {
	fullText?: string;
}

function rebuildText(session: SessionRecord, chunks: ChunkRecord[]) {
	if (session.fullText?.trim()) {
		return session.fullText;
	}
	return chunks
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((chunk) => chunk.text)
		.join('\n\n')
		.trim();
}

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const sessionId = params.sessionId?.trim();
		if (!sessionId) {
			return json({ error: 'sessionId is required.' }, { status: 400 });
		}

		const body = (await request.json().catch(() => ({}))) as { count?: number };
		const client = convexClient();
		const [session, chunks] = await Promise.all([
			client.query(convexFunctions.getSession, { sessionId: sessionId as never }),
			client.query(convexFunctions.getChunks, { sessionId: sessionId as never })
		]);

		if (!session) {
			return json({ error: 'Session not found.' }, { status: 404 });
		}

		const fullText = rebuildText(session as SessionRecord, chunks as ChunkRecord[]);
		if (!fullText) {
			return json({ error: 'Session has no extractable text.' }, { status: 400 });
		}

		const queries = await generateResearchQueries(fullText, body.count ?? 8);
		return json({ queries });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to generate queries.';
		return json({ error: message }, { status: 500 });
	}
};
