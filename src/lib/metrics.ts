import type { PipelineRun } from './types';

export function average(items: number[]) {
	if (items.length === 0) return 0;
	return items.reduce((sum, item) => sum + item, 0) / items.length;
}

export function hallucinationRateFromCounts(hallucinationCount: number, sentenceCount: number) {
	return Math.min(1, hallucinationCount / Math.max(sentenceCount, 1));
}

export function trustEfficiencyFromValues(
	reliability: number,
	hallucinationRate: number,
	contextLength: number
) {
	const boundedReliability = Math.max(0, Math.min(1, reliability));
	const boundedHallucinationRate = Math.max(0, Math.min(1, hallucinationRate));
	const length = Math.max(contextLength, 0.001);
	return (boundedReliability * (1 - boundedHallucinationRate)) / Math.log(1 + length);
}

export function runHallucinationRate(run: Pick<PipelineRun, 'hallucinationCount' | 'sentences'>) {
	return hallucinationRateFromCounts(run.hallucinationCount, run.sentences?.length ?? 0);
}

export function runTrustEfficiency(
	run: Pick<PipelineRun, 'confidence' | 'hallucinationCount' | 'sentences' | 'contextChars'>
) {
	return trustEfficiencyFromValues(
		run.confidence / 100,
		runHallucinationRate(run),
		Math.max(run.contextChars / 1000, 0.001)
	);
}

export function pairKey(
	run: Pick<PipelineRun, 'sessionId' | 'query' | 'modelFamily' | 'modelName' | 'noiseInjected'>
) {
	return `${run.sessionId ?? ''}:${run.query ?? ''}:${run.modelFamily || run.modelName}:${run.noiseInjected ? 'noise' : 'clean'}`;
}

export function groupPipelinePairs(runs: PipelineRun[]) {
	const map = new Map<string, Partial<Record<PipelineRun['pipeline'], PipelineRun>>>();
	for (const run of runs) {
		const current = map.get(pairKey(run)) ?? {};
		current[run.pipeline] = run;
		map.set(pairKey(run), current);
	}
	return Array.from(map.values());
}

export function pairedNetUplift(runs: PipelineRun[]) {
	const deltas = groupPipelinePairs(runs)
		.map((pair) =>
			pair.rag && pair.full_context ? pair.rag.confidence - pair.full_context.confidence : null
		)
		.filter((item): item is number => item !== null);
	const sorted = [...deltas].sort((a, b) => a - b);
	return {
		count: deltas.length,
		mean: Number(average(deltas).toFixed(2)),
		median: Number((sorted[Math.floor(Math.max(sorted.length - 1, 0) / 2)] ?? 0).toFixed(2))
	};
}

export function noiseSlopeForRuns(runs: PipelineRun[], pipeline: PipelineRun['pipeline']) {
	const clean = runs.filter((run) => run.pipeline === pipeline && !run.noiseInjected);
	const noisy = runs.filter((run) => run.pipeline === pipeline && run.noiseInjected);
	return average(clean.map((run) => run.confidence)) - average(noisy.map((run) => run.confidence));
}

export function noiseSlopeReduction(runs: PipelineRun[]) {
	const fullSlope = noiseSlopeForRuns(runs, 'full_context');
	const ragSlope = noiseSlopeForRuns(runs, 'rag');
	return fullSlope <= 0 ? 0 : Number((((fullSlope - ragSlope) / fullSlope) * 100).toFixed(1));
}

export function middlePositionRecovery(runs: PipelineRun[]) {
	const recoveries = groupPipelinePairs(runs)
		.filter((pair) => {
			const bins = pair.rag?.positionBins ?? pair.full_context?.positionBins ?? [];
			return bins.some((bin) => bin.bin >= 3 && bin.bin <= 4 && bin.hits > 0);
		})
		.map((pair) => {
			if (!pair.no_context || !pair.full_context || !pair.rag) return null;
			const fullLoss = pair.no_context.confidence - pair.full_context.confidence;
			const ragLift = pair.rag.confidence - pair.full_context.confidence;
			if (fullLoss <= 0) return null;
			return Math.max(0, Math.min(100, (ragLift / fullLoss) * 100));
		})
		.filter((item): item is number => item !== null);

	return {
		value: Number(average(recoveries).toFixed(1)),
		count: recoveries.length
	};
}
