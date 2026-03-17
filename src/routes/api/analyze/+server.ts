import { json, type RequestHandler } from '@sveltejs/kit';
import { convexClient, convexFunctions } from '$lib/server/convex';
import {
	injectNoise,
	listExperimentModels,
	makeFullContext,
	makeNoContext,
	makeRagContext,
	runPipeline
} from '$lib/server/analysis';

interface ChunkRecord {
	order: number;
	text: string;
	tokens: string[];
}

function sse(data: unknown) {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			sessionId?: string;
			query?: string;
			noiseInjection?: boolean;
		};
		const sessionId = body.sessionId?.trim();
		const query = body.query?.trim();
		const noiseInjection = Boolean(body.noiseInjection);

		if (!sessionId || !query) {
			return json({ error: 'sessionId and query are required.' }, { status: 400 });
		}

		const client = convexClient();
		const session = await client.query(convexFunctions.getSession, {
			sessionId: sessionId as never
		});
		if (!session) {
			return json({ error: 'Session not found.' }, { status: 404 });
		}

		const allChunks = (await client.query(convexFunctions.getChunks, {
			sessionId: sessionId as never
		})) as ChunkRecord[];
		const models = await listExperimentModels();

		const tasks = models.flatMap((model) => {
			const noContext = injectNoise(makeNoContext(query), false);
			const fullContext = injectNoise(makeFullContext(session.fullText, allChunks), noiseInjection);
			const ragContext = injectNoise(makeRagContext(query, allChunks), noiseInjection);

			return [
				{ model, pipeline: 'no_context' as const, context: noContext },
				{ model, pipeline: 'full_context' as const, context: fullContext },
				{ model, pipeline: 'rag' as const, context: ragContext }
			];
		});

		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				const send = (payload: unknown) => controller.enqueue(encoder.encode(sse(payload)));

				const execute = async () => {
					send({ type: 'status', message: 'Launching triple-answer engine...', progress: 0 });

					let completed = 0;
					for (const task of tasks) {
						send({
							type: 'status',
							message: `Running ${task.pipeline} on ${task.model.id}`,
							model: task.model.id,
							progress: Math.round((completed / tasks.length) * 100)
						});

						const run = await runPipeline({
							pipeline: task.pipeline,
							query,
							context: task.context,
							modelId: task.model.id,
							modelFamily: task.model.family,
							modelContextWindow: task.model.contextWindow,
							noiseInjected: noiseInjection
						});

						await client.mutation(convexFunctions.createRun, {
							sessionId: sessionId as never,
							query,
							pipeline: run.pipeline,
							modelFamily: run.modelFamily,
							modelName: run.modelName,
							answer: run.answer,
							confidence: run.confidence,
							hallucinationCount: run.hallucinationCount,
							hallucinations: run.hallucinations,
							sentences: run.sentences,
							citations: run.citations,
							positionBins: run.positionBins,
							contextChars: run.contextChars,
							contextChunks: run.contextChunks,
							contextCoverage: run.contextCoverage,
							noiseInjected: run.noiseInjected,
							latencyMs: run.latencyMs
						});

						send({
							type: 'run',
							run: {
								...run,
								sessionId,
								sessionName: session.filename,
								query,
								createdAt: Date.now()
							}
						});

						completed += 1;
					}

					send({
						type: 'done',
						message: 'All runs completed.',
						progress: 100
					});
					controller.close();
				};

				execute().catch((error: unknown) => {
					send({
						type: 'error',
						error: error instanceof Error ? error.message : 'Analysis failed.'
					});
					controller.close();
				});
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive'
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Analysis failed.';
		return json({ error: message }, { status: 500 });
	}
};
