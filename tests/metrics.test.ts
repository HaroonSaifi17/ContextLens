import assert from 'node:assert/strict';
import {
	middlePositionRecovery,
	noiseSlopeReduction,
	pairedNetUplift,
	trustEfficiencyFromValues
} from '../src/lib/metrics.ts';
import type { PipelineRun } from '../src/lib/types.ts';

function nearlyEqual(actual: number, expected: number, epsilon = 0.000001) {
	assert.ok(Math.abs(actual - expected) < epsilon, `${actual} !== ${expected}`);
}

nearlyEqual(trustEfficiencyFromValues(0.8, 0.25, 10), (0.8 * 0.75) / Math.log(11));

const baseRun = {
	sessionId: 's1',
	query: 'middle query',
	modelFamily: 'm1',
	modelName: 'model',
	provider: 'Groq',
	answer: '',
	confidence: 0,
	hallucinationCount: 0,
	hallucinations: [],
	sentences: [],
	citations: [],
	positionBins: [
		{ bin: 3, rangeLabel: '38-50%', hits: 1 },
		{ bin: 4, rangeLabel: '50-63%', hits: 1 }
	],
	contextChars: 1000,
	contextChunks: 1,
	contextCoverage: 100,
	noiseInjected: false,
	latencyMs: 1
} satisfies Omit<PipelineRun, 'pipeline'>;

const runs: PipelineRun[] = [
	{ ...baseRun, pipeline: 'no_context', confidence: 80 },
	{ ...baseRun, pipeline: 'full_context', confidence: 60 },
	{ ...baseRun, pipeline: 'rag', confidence: 74 },
	{ ...baseRun, query: 'noise query', pipeline: 'full_context', confidence: 90 },
	{
		...baseRun,
		query: 'noise query',
		pipeline: 'full_context',
		confidence: 70,
		noiseInjected: true
	},
	{ ...baseRun, query: 'noise query', pipeline: 'rag', confidence: 88 },
	{ ...baseRun, query: 'noise query', pipeline: 'rag', confidence: 82, noiseInjected: true }
];

assert.deepEqual(pairedNetUplift(runs), { count: 3, mean: 8, median: 12 });
assert.deepEqual(middlePositionRecovery(runs), { value: 70, count: 1 });
assert.equal(noiseSlopeReduction(runs), 120);

console.log('metrics tests passed');
