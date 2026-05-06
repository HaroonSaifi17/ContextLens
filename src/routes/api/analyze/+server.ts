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

interface SessionRecord {
	filename: string;
	fullText?: string;
}

function findOverlap(previous: string, next: string) {
	const maxOverlap = Math.min(previous.length, next.length, 300);
	for (let size = maxOverlap; size >= 40; size -= 1) {
		if (previous.endsWith(next.slice(0, size))) {
			return size;
		}
	}
	return 0;
}

function buildFullContextText(session: SessionRecord, chunks: ChunkRecord[]) {
	if (typeof session.fullText === 'string' && session.fullText.trim().length > 0) {
		return session.fullText;
	}

	let rebuilt = '';
	for (const chunk of chunks.slice().sort((a, b) => a.order - b.order)) {
		if (!chunk.text) {
			continue;
		}
		if (!rebuilt) {
			rebuilt = chunk.text;
			continue;
		}

		const overlap = findOverlap(rebuilt, chunk.text);
		rebuilt += chunk.text.slice(overlap);
	}

	return rebuilt.trim();
}

function sse(data: unknown) {
	return `data: ${JSON.stringify(data)}\n\n`;
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'unknown error';
}

function isRateLimitError(message: string) {
	const normalized = message.toLowerCase();
	return (
		normalized.includes('rate limit') ||
		normalized.includes('rate_limit') ||
		normalized.includes('429') ||
		normalized.includes('too many requests') ||
		normalized.includes('tokens per minute') ||
		normalized.includes('requests per minute')
	);
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as {
			sessionId?: string;
			query?: string;
			queries?: string[];
			noiseInjection?: boolean;
		};
		const sessionId = body.sessionId?.trim();
		const queries = [...(body.queries ?? []), ...(body.query ? [body.query] : [])]
			.map((item) => item.trim())
			.filter(Boolean);
		const noiseInjection = Boolean(body.noiseInjection);

		if (!sessionId || queries.length === 0) {
			return json({ error: 'sessionId and at least one query are required.' }, { status: 400 });
		}

		const client = convexClient();
		const session = (await client.query(convexFunctions.getSession, {
			sessionId: sessionId as never
		})) as SessionRecord | null;
		if (!session) {
			return json({ error: 'Session not found.' }, { status: 404 });
		}

		const allChunks = (await client.query(convexFunctions.getChunks, {
			sessionId: sessionId as never
		})) as ChunkRecord[];
		const orderedChunks = allChunks.slice().sort((a, b) => a.order - b.order);
		const fullContextText = buildFullContextText(session, orderedChunks);

		if (!fullContextText) {
			return json({ error: 'Session has no extractable text.' }, { status: 400 });
		}

		const models = await listExperimentModels();

		const tasks = queries.flatMap((query) =>
			models.flatMap((model) => {
				const noContext = injectNoise(makeNoContext(query), false);
				const fullContext = injectNoise(
					makeFullContext(fullContextText, orderedChunks),
					noiseInjection
				);
				const ragContext = injectNoise(makeRagContext(query, orderedChunks), noiseInjection);

				return [
					{ query, model, pipeline: 'no_context' as const, context: noContext },
					{ query, model, pipeline: 'full_context' as const, context: fullContext },
					{ query, model, pipeline: 'rag' as const, context: ragContext }
				];
			})
		);

		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				const send = (payload: unknown) => controller.enqueue(encoder.encode(sse(payload)));

				const execute = async () => {
					send({
						type: 'status',
						message:
							queries.length > 1
								? `Launching research batch: ${queries.length} queries x ${models.length} models x 3 modes`
								: 'Launching triple-answer engine...',
						progress: 0
					});

					let completed = 0;
					const executeTask = async (task: (typeof tasks)[number], taskIndex: number) => {
						if (taskIndex > 0) {
							await delay(500); // Constant spacing between sequential requests
						}
						send({
							type: 'status',
							status: 'started',
							message: `Running ${task.pipeline} on ${task.model.id}`,
							model: task.model.id,
							pipeline: task.pipeline,
							query: task.query,
							progress: Math.round((completed / tasks.length) * 100)
						});
						console.log(
							`[analyze] started model=${task.model.id} pipeline=${task.pipeline} query="${task.query.slice(0, 120)}"`
						);

						try {
							const run = await runPipeline({
								pipeline: task.pipeline,
								query: task.query,
								context: task.context,
								modelId: task.model.id,
								modelFamily: task.model.family,
								provider: task.model.provider,
								modelContextWindow: task.model.contextWindow,
								noiseInjected: noiseInjection
							});

							await client.mutation(convexFunctions.createRun, {
								sessionId: sessionId as never,
								query: task.query,
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
								trustEfficiency: run.trustEfficiency,
								noiseSlope: run.noiseSlope,
								middleRecovery: run.middleRecovery,
								noiseInjected: run.noiseInjected,
								latencyMs: run.latencyMs
							});

							send({
								type: 'run',
								run: {
									...run,
									sessionId,
									sessionName: session.filename,
									query: task.query,
									createdAt: Date.now()
								}
							});
							send({
								type: 'status',
								status: 'succeeded',
								message: `Succeeded ${task.pipeline} on ${task.model.id} (${run.latencyMs} ms)`,
								model: task.model.id,
								pipeline: task.pipeline,
								query: task.query,
								progress: Math.round(((completed + 1) / tasks.length) * 100)
							});
							console.log(
								`[analyze] succeeded model=${task.model.id} pipeline=${task.pipeline} confidence=${run.confidence} latencyMs=${run.latencyMs}`
							);
						} catch (error) {
							const message = errorMessage(error);
							const rateLimited = isRateLimitError(message);
							send({
								type: 'status',
								status: rateLimited ? 'rate_limited' : 'failed',
								message: `${rateLimited ? 'Rate limited' : 'Failed'} ${task.pipeline} on ${task.model.id}: ${message}`,
								model: task.model.id,
								pipeline: task.pipeline,
								query: task.query,
								progress: Math.round((completed / tasks.length) * 100)
							});
							console.warn(
								`[analyze] ${rateLimited ? 'rate_limited' : 'failed'} model=${task.model.id} pipeline=${task.pipeline} query="${task.query.slice(0, 120)}" error=${message}`
							);
						} finally {
							completed += 1;
						}
					};

					for (const [index, task] of tasks.entries()) {
						await executeTask(task, index);
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
