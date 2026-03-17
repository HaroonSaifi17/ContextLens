import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';

interface RunRecord {
	query: string;
	pipeline: 'no_context' | 'full_context' | 'rag' | 'baseline';
	modelFamily?: string;
	confidence: number;
	hallucinationCount: number;
	latencyMs: number;
	noiseInjected?: boolean;
	createdAt: number;
	sessionId: string;
}

interface SessionRecord {
	_id: string;
	filename: string;
}

export const GET: RequestHandler = async () => {
	try {
		const client = convexClient();
		const [runs, sessions] = await Promise.all([
			client.query(convexFunctions.getAllRuns, {}),
			client.query(convexFunctions.listSessions, {})
		]);

		const runList = runs as RunRecord[];
		const sessionMap = new Map<string, SessionRecord>();
		for (const session of sessions as SessionRecord[]) {
			sessionMap.set(String(session._id), session);
		}

		const groupedByPipeline = new Map<string, RunRecord[]>();
		for (const run of runList) {
			const list = groupedByPipeline.get(run.pipeline) ?? [];
			list.push(run);
			groupedByPipeline.set(run.pipeline, list);
		}

		const summary = Array.from(groupedByPipeline.entries()).map(([pipeline, items]) => ({
			pipeline,
			avgConfidence: Math.round(
				items.reduce((sum, item) => sum + item.confidence, 0) / items.length
			),
			avgHallucinations: Number(
				(items.reduce((sum, item) => sum + item.hallucinationCount, 0) / items.length).toFixed(2)
			),
			avgLatencyMs: Math.round(items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length),
			runs: items.length
		}));

		const report = {
			generatedAt: new Date().toISOString(),
			totalRuns: runList.length,
			totalQueries: new Set(runList.map((run) => run.query)).size,
			totalSessions: new Set(runList.map((run) => String(run.sessionId))).size,
			summary,
			recentRuns: runList.slice(0, 50).map((run) => ({
				session: sessionMap.get(String(run.sessionId))?.filename ?? 'Unknown session',
				query: run.query,
				pipeline: run.pipeline,
				modelFamily: run.modelFamily ?? 'legacy',
				confidence: run.confidence,
				hallucinationCount: run.hallucinationCount,
				latencyMs: run.latencyMs,
				noiseInjected: run.noiseInjected ?? false,
				createdAt: run.createdAt
			}))
		};

		return json(report);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to build report.';
		return json({ error: message }, { status: 500 });
	}
};
