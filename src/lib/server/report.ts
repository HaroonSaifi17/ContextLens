import { convexClient, convexFunctions } from '$lib/server/convex';
import type { PipelineRun } from '$lib/types';
import { middlePositionRecovery } from '$lib/metrics';

interface RunRecord {
	query: string;
	pipeline: 'no_context' | 'full_context' | 'rag' | 'baseline';
	modelFamily?: string;
	modelName?: string;
	confidence: number;
	hallucinationCount: number;
	sentences?: Array<{ text: string }>;
	positionBins?: Array<{ bin: number; rangeLabel: string; hits: number }>;
	contextChars?: number;
	contextChunks?: number;
	contextCoverage?: number;
	trustEfficiency?: number;
	noiseSlope?: number;
	middleRecovery?: number;
	latencyMs: number;
	noiseInjected?: boolean;
	createdAt: number;
	sessionId: string;
}

interface SessionRecord {
	_id: string;
	filename: string;
}

export interface ReliabilityReport {
	generatedAt: string;
	totalRuns: number;
	totalQueries: number;
	totalSessions: number;
	summary: Array<{
		pipeline: string;
		avgConfidence: number;
		avgHallucinations: number;
		avgLatencyMs: number;
		runs: number;
	}>;
	recentRuns: Array<{
		session: string;
		query: string;
		pipeline: string;
		modelFamily: string;
		confidence: number;
		hallucinationCount: number;
		latencyMs: number;
		noiseInjected: boolean;
		createdAt: number;
	}>;
	researchMetrics: {
		pairedCount: number;
		pairedMeanUpliftPp: number;
		pairedMedianUpliftPp: number;
		trustEfficiencyFullContext: number;
		trustEfficiencyRag: number;
		trustEfficiencyGainPct: number;
		noiseSlopeReductionPct: number;
		middleRecoveryPct: number;
	};
	paperVariables: Record<string, number>;
	latexTables: {
		variables: string;
		pairedUplift: string;
		reliabilityPatterns: string;
	};
}

function average(items: number[]) {
	if (items.length === 0) return 0;
	return items.reduce((sum, item) => sum + item, 0) / items.length;
}

function hallucinationRate(run: RunRecord) {
	return Math.min(1, run.hallucinationCount / Math.max(run.sentences?.length ?? 0, 1));
}

function trustEfficiency(run: RunRecord) {
	const reliability = run.confidence / 100;
	const lengthK = Math.max((run.contextChars ?? 0) / 1000, 0.001);
	return (reliability * (1 - hallucinationRate(run))) / Math.log(1 + lengthK);
}

function pairKey(run: RunRecord) {
	return `${run.sessionId}:${run.query}:${run.modelFamily ?? run.modelName ?? 'model'}:${run.noiseInjected ? 'noise' : 'clean'}`;
}

function researchMetrics(runList: RunRecord[]) {
	const pairs = new Map<string, Partial<Record<RunRecord['pipeline'], RunRecord>>>();
	for (const run of runList) {
		const current = pairs.get(pairKey(run)) ?? {};
		current[run.pipeline] = run;
		pairs.set(pairKey(run), current);
	}
	const deltas = Array.from(pairs.values())
		.map((pair) =>
			pair.rag && pair.full_context ? pair.rag.confidence - pair.full_context.confidence : null
		)
		.filter((item): item is number => item !== null);
	const sortedDeltas = [...deltas].sort((a, b) => a - b);
	const fullTrust = average(
		runList.filter((run) => run.pipeline === 'full_context').map(trustEfficiency)
	);
	const ragTrust = average(runList.filter((run) => run.pipeline === 'rag').map(trustEfficiency));
	const cleanFull = average(
		runList
			.filter((run) => run.pipeline === 'full_context' && !run.noiseInjected)
			.map((run) => run.confidence)
	);
	const noisyFull = average(
		runList
			.filter((run) => run.pipeline === 'full_context' && run.noiseInjected)
			.map((run) => run.confidence)
	);
	const cleanRag = average(
		runList
			.filter((run) => run.pipeline === 'rag' && !run.noiseInjected)
			.map((run) => run.confidence)
	);
	const noisyRag = average(
		runList
			.filter((run) => run.pipeline === 'rag' && run.noiseInjected)
			.map((run) => run.confidence)
	);
	const fullSlope = cleanFull - noisyFull;
	const ragSlope = cleanRag - noisyRag;

	return {
		pairedCount: deltas.length,
		pairedMeanUpliftPp: Number(average(deltas).toFixed(2)),
		pairedMedianUpliftPp: Number(
			(sortedDeltas[Math.floor(Math.max(sortedDeltas.length - 1, 0) / 2)] ?? 0).toFixed(2)
		),
		trustEfficiencyFullContext: Number(fullTrust.toFixed(3)),
		trustEfficiencyRag: Number(ragTrust.toFixed(3)),
		trustEfficiencyGainPct:
			fullTrust === 0 ? 0 : Number((((ragTrust - fullTrust) / fullTrust) * 100).toFixed(1)),
		noiseSlopeReductionPct:
			fullSlope <= 0 ? 0 : Number((((fullSlope - ragSlope) / fullSlope) * 100).toFixed(1)),
		middleRecoveryPct: middlePositionRecovery(runList as unknown as PipelineRun[]).value
	};
}

function buildLatexTables(metrics: ReturnType<typeof researchMetrics>) {
	const variables = String.raw`\providecommand{\PairedComparisonCount}{${metrics.pairedCount}}
\providecommand{\PairedMeanDelta}{${metrics.pairedMeanUpliftPp}}
\providecommand{\PairedMedianDelta}{${metrics.pairedMedianUpliftPp}}
\providecommand{\RAGMiddleRecovery}{${metrics.middleRecoveryPct}}
\providecommand{\RAGNoiseSlopeReduction}{${metrics.noiseSlopeReductionPct}}
\providecommand{\RAGTrustEfficiencyGain}{${metrics.trustEfficiencyGainPct}}`;
	const pairedUplift = String.raw`\begin{table}[htbp]
\centering
\caption{Paired ContextLens Benchmark Uplift Summary}
\label{tab:contextlens-paired-uplift}
\renewcommand{\arraystretch}{1.2}
\begin{tabularx}{0.7\textwidth}{>{\raggedright\arraybackslash}X c}
\toprule
\textbf{Statistic} & \textbf{Value} \\
\midrule
Number of paired comparisons & ${metrics.pairedCount} \\
Mean uplift & ${metrics.pairedMeanUpliftPp} pp \\
Median uplift & ${metrics.pairedMedianUpliftPp} pp \\
\bottomrule
\end{tabularx}
\end{table}`;
	const reliabilityPatterns = String.raw`\begin{table}[htbp]
\centering
\caption{Protocol Benchmark Reliability Patterns}
\label{tab:contextlens-patterns-generated}
\renewcommand{\arraystretch}{1.2}
\begin{tabularx}{0.8\textwidth}{>{\raggedright\arraybackslash}X c c}
\toprule
\textbf{Metric} & \textbf{Full Context} & \textbf{RAG} \\
\midrule
Trust-efficiency & ${metrics.trustEfficiencyFullContext} & ${metrics.trustEfficiencyRag} \\
Trust-efficiency gain & -- & ${metrics.trustEfficiencyGainPct}\% \\
Middle-position recovery & -- & ${metrics.middleRecoveryPct}\% \\
Noise-slope reduction & -- & ${metrics.noiseSlopeReductionPct}\% \\
\bottomrule
\end{tabularx}
\end{table}`;
	return { variables, pairedUplift, reliabilityPatterns };
}

export async function buildReliabilityReport(): Promise<ReliabilityReport> {
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
		avgConfidence: Math.round(items.reduce((sum, item) => sum + item.confidence, 0) / items.length),
		avgHallucinations: Number(
			(items.reduce((sum, item) => sum + item.hallucinationCount, 0) / items.length).toFixed(2)
		),
		avgLatencyMs: Math.round(items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length),
		runs: items.length
	}));
	const metrics = researchMetrics(runList);
	const paperVariables = {
		PairedComparisonCount: metrics.pairedCount,
		PairedMeanDelta: metrics.pairedMeanUpliftPp,
		PairedMedianDelta: metrics.pairedMedianUpliftPp,
		RAGMiddleRecovery: metrics.middleRecoveryPct,
		RAGNoiseSlopeReduction: metrics.noiseSlopeReductionPct,
		RAGTrustEfficiencyGain: metrics.trustEfficiencyGainPct
	};

	return {
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
		})),
		researchMetrics: metrics,
		paperVariables,
		latexTables: buildLatexTables(metrics)
	};
}
