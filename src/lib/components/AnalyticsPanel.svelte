<script lang="ts">
	import {
		BarChart3,
		TrendingUp,
		ShieldAlert,
		Flame,
		Download,
		FileText,
		Scale,
		Target
	} from 'lucide-svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import { Button } from '$lib/components/ui/button';
	import type { PipelineRun } from '$lib/types';

	let { runs = [] as PipelineRun[], allRuns = [] as PipelineRun[] } = $props<{
		runs: PipelineRun[];
		allRuns: PipelineRun[];
	}>();

	const grouped = $derived.by(() => {
		const groups = new Map<string, PipelineRun[]>();
		for (const run of allRuns) {
			const key = `${run.modelFamily}:${run.pipeline}`;
			const current = groups.get(key) ?? [];
			current.push(run);
			groups.set(key, current);
		}
		return Array.from(groups.entries()).map(([key, items]) => {
			const [family, pipeline] = key.split(':');
			const avgConfidence = Math.round(
				items.reduce((sum, item) => sum + item.confidence, 0) / items.length
			);
			const avgHall = Number(
				(items.reduce((sum, item) => sum + item.hallucinationCount, 0) / items.length).toFixed(2)
			);
			const avgLatency = Math.round(
				items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length
			);
			return {
				family,
				pipeline,
				avgConfidence,
				avgHall,
				avgLatency,
				runs: items.length
			};
		});
	});

	function hallucinationRate(run: PipelineRun) {
		const sentenceCount = Math.max(run.sentences?.length ?? 0, 1);
		return Math.min(1, run.hallucinationCount / sentenceCount);
	}

	function trustEfficiency(run: PipelineRun) {
		const reliability = run.confidence / 100;
		const lengthK = Math.max(run.contextChars / 1000, 0.001);
		return (reliability * (1 - hallucinationRate(run))) / Math.log(1 + lengthK);
	}

	function average(items: number[]) {
		if (items.length === 0) return 0;
		return items.reduce((sum, item) => sum + item, 0) / items.length;
	}

	function runKey(run: PipelineRun) {
		return `${run.sessionId ?? ''}:${run.query ?? ''}:${run.modelFamily}:${run.noiseInjected ? 'noise' : 'clean'}`;
	}

	function groupByPair(runsToGroup: PipelineRun[]) {
		const map = new Map<string, Partial<Record<PipelineRun['pipeline'], PipelineRun>>>();
		for (const run of runsToGroup) {
			const current = map.get(runKey(run)) ?? {};
			current[run.pipeline] = run;
			map.set(runKey(run), current);
		}
		return Array.from(map.values());
	}

	const pairedNetUplift = $derived.by(() => {
		const deltas = groupByPair(allRuns)
			.map((pair) =>
				pair.rag && pair.full_context ? pair.rag.confidence - pair.full_context.confidence : null
			)
			.filter((item): item is number => item !== null);
		return {
			count: deltas.length,
			mean: Number(average(deltas).toFixed(2)),
			median: Number(
				[...deltas]
					.sort((a, b) => a - b)
					[Math.floor(Math.max(deltas.length - 1, 0) / 2)]?.toFixed(2) ?? 0
			)
		};
	});

	const trustEfficiencySummary = $derived.by(() => {
		const full = allRuns
			.filter((run: PipelineRun) => run.pipeline === 'full_context')
			.map(trustEfficiency);
		const rag = allRuns.filter((run: PipelineRun) => run.pipeline === 'rag').map(trustEfficiency);
		const fullAvg = average(full);
		const ragAvg = average(rag);
		return {
			full: Number(fullAvg.toFixed(3)),
			rag: Number(ragAvg.toFixed(3)),
			gain: fullAvg === 0 ? 0 : Number((((ragAvg - fullAvg) / fullAvg) * 100).toFixed(1))
		};
	});

	const middleRecovery = $derived.by(() => {
		const pairs = groupByPair(allRuns).filter((pair) => {
			const bins = pair.rag?.positionBins ?? pair.full_context?.positionBins ?? [];
			return bins.some((bin) => bin.bin >= 3 && bin.bin <= 4 && bin.hits > 0);
		});
		const recoveries = pairs
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
	});

	const noiseSlopeReduction = $derived.by(() => {
		function slopeFor(pipeline: PipelineRun['pipeline']) {
			const clean = allRuns.filter(
				(run: PipelineRun) => run.pipeline === pipeline && !run.noiseInjected
			);
			const noisy = allRuns.filter(
				(run: PipelineRun) => run.pipeline === pipeline && run.noiseInjected
			);
			return (
				average(clean.map((run: PipelineRun) => run.confidence)) -
				average(noisy.map((run: PipelineRun) => run.confidence))
			);
		}
		const fullSlope = slopeFor('full_context');
		const ragSlope = slopeFor('rag');
		return fullSlope <= 0 ? 0 : Number((((fullSlope - ragSlope) / fullSlope) * 100).toFixed(1));
	});

	const rankStability = $derived.by(() => {
		const byPipeline = new Map<PipelineRun['pipeline'], PipelineRun[]>();
		for (const run of allRuns) {
			const current = byPipeline.get(run.pipeline) ?? [];
			current.push(run);
			byPipeline.set(run.pipeline, current);
		}
		const modes: PipelineRun['pipeline'][] = ['rag', 'full_context', 'no_context'];
		const metricRows = modes.map((mode) => {
			const items = byPipeline.get(mode) ?? [];
			return {
				mode,
				reliability: average(items.map((run) => run.confidence / 100)),
				grounding: 1 - average(items.map(hallucinationRate)),
				efficiency: average(items.map((run) => 1 / Math.log(2 + run.contextChars / 1000)))
			};
		});
		const maxByMetric = {
			reliability: Math.max(...metricRows.map((row) => row.reliability), 0.001),
			grounding: Math.max(...metricRows.map((row) => row.grounding), 0.001),
			efficiency: Math.max(...metricRows.map((row) => row.efficiency), 0.001)
		};
		const wins = new Map(modes.map((mode) => [mode, 0]));
		const trials = allRuns.length > 0 ? 2000 : 0;
		for (let index = 0; index < trials; index += 1) {
			const a = ((index * 37) % 101) + 1;
			const b = ((index * 53) % 101) + 1;
			const c = ((index * 97) % 101) + 1;
			const total = a + b + c;
			const ranked = metricRows
				.map((row) => ({
					mode: row.mode,
					score:
						(a / total) * (row.reliability / maxByMetric.reliability) +
						(b / total) * (row.grounding / maxByMetric.grounding) +
						(c / total) * (row.efficiency / maxByMetric.efficiency)
				}))
				.sort((left, right) => right.score - left.score);
			wins.set(ranked[0].mode, (wins.get(ranked[0].mode) ?? 0) + 1);
		}
		return modes.map((mode) => ({
			mode,
			winProbability: trials === 0 ? 0 : Number((((wins.get(mode) ?? 0) / trials) * 100).toFixed(1))
		}));
	});

	const topPerformer = $derived.by(() => {
		if (grouped.length === 0) {
			return 'Awaiting runs';
		}
		const sorted = [...grouped].sort((a, b) => b.avgConfidence - a.avgConfidence);
		return `${sorted[0].family} / ${sorted[0].pipeline}`;
	});

	const avgReliability = $derived.by(() => {
		if (allRuns.length === 0) {
			return 0;
		}
		return Math.round(
			allRuns.reduce((sum: number, run: PipelineRun) => sum + run.confidence, 0) / allRuns.length
		);
	});

	const overallHallRate = $derived.by(() => {
		if (allRuns.length === 0) {
			return 0;
		}
		const total = allRuns.reduce(
			(sum: number, run: PipelineRun) => sum + run.hallucinationCount,
			0
		);
		return Number((total / allRuns.length).toFixed(2));
	});

	const currentHeatmap = $derived.by(() => {
		const ragRuns = runs.filter((run: PipelineRun) => run.pipeline === 'rag');
		if (ragRuns.length === 0) {
			return [];
		}
		const aggregate = new Map<number, { label: string; hits: number }>();
		for (const run of ragRuns) {
			for (const bin of run.positionBins) {
				const item = aggregate.get(bin.bin) ?? { label: bin.rangeLabel, hits: 0 };
				item.hits += bin.hits;
				aggregate.set(bin.bin, item);
			}
		}
		const maxHits = Math.max(...Array.from(aggregate.values()).map((item) => item.hits), 1);
		return Array.from(aggregate.entries())
			.sort((a, b) => a[0] - b[0])
			.map(([bin, value]) => ({
				bin,
				label: value.label,
				hits: value.hits,
				intensity: Math.round((value.hits / maxHits) * 100)
			}));
	});

	const noiseImpact = $derived.by(() => {
		const noisy = allRuns.filter((run: PipelineRun) => run.noiseInjected);
		const clean = allRuns.filter((run: PipelineRun) => !run.noiseInjected);
		if (noisy.length === 0 || clean.length === 0) {
			return 0;
		}
		const noisyConf =
			noisy.reduce((sum: number, run: PipelineRun) => sum + run.confidence, 0) / noisy.length;
		const cleanConf =
			clean.reduce((sum: number, run: PipelineRun) => sum + run.confidence, 0) / clean.length;
		return Math.round(cleanConf - noisyConf);
	});

	async function exportReport() {
		const response = await fetch('/api/report');
		if (!response.ok) {
			return;
		}
		const payload = await response.json();
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `reliability-report-${Date.now()}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	async function exportLatexReport() {
		const response = await fetch('/api/report?format=latex');
		if (!response.ok) {
			return;
		}
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `contextlens-latex-${Date.now()}.tex`;
		link.click();
		URL.revokeObjectURL(url);
	}

	async function exportPdfReport() {
		const response = await fetch('/api/report/pdf');
		if (!response.ok) {
			return;
		}
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `reliability-report-${Date.now()}.pdf`;
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<div
	class="h-full overflow-y-auto p-3 sm:p-8 space-y-6 sm:space-y-8 bg-background text-muted-foreground"
>
	<div class="flex flex-col sm:flex-row items-start justify-between gap-4">
		<div>
			<h2
				class="text-2xl font-black uppercase tracking-tighter text-foreground flex items-center gap-3 mb-2"
			>
				<BarChart3 class="w-6 h-6 text-primary" /> Reliability Dashboard
			</h2>
			<p class="text-sm text-muted-foreground uppercase tracking-widest font-bold">
				All sessions + all runs analytics
			</p>
		</div>
		<div class="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
			<Button
				variant="outline"
				onclick={exportLatexReport}
				class="uppercase font-bold text-xs tracking-widest w-full sm:w-auto"
			>
				<FileText class="w-4 h-4" /> Export TeX
			</Button>
			<Button
				variant="outline"
				onclick={exportPdfReport}
				class="uppercase font-bold text-xs tracking-widest w-full sm:w-auto"
			>
				<FileText class="w-4 h-4" /> Export PDF
			</Button>
			<Button
				variant="outline"
				onclick={exportReport}
				class="uppercase font-bold text-xs tracking-widest w-full sm:w-auto"
			>
				<Download class="w-4 h-4" /> Export JSON
			</Button>
		</div>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
		<Card class="bg-muted/30 shadow-none border-border"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1">Top Performer</div>
				<div class="text-sm font-bold text-emerald-500">{topPerformer}</div></CardContent
			></Card
		>
		<Card class="bg-muted/30 shadow-none border-border"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1">Avg Reliability</div>
				<div class="text-xl font-bold text-foreground">{avgReliability}%</div></CardContent
			></Card
		>
		<Card class="bg-rose-500/5 shadow-none border-rose-500/20"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-1">
					<ShieldAlert class="w-3 h-3" /> Hallucination Rate
				</div>
				<div class="text-xl font-bold text-rose-500">{overallHallRate}</div></CardContent
			></Card
		>
		<Card class="bg-amber-500/5 shadow-none border-amber-500/20"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-1">
					<Flame class="w-3 h-3" /> Noise Impact
				</div>
				<div class="text-xl font-bold text-amber-500">-{noiseImpact}%</div></CardContent
			></Card
		>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
		<Card class="bg-muted/30 shadow-none border-border"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-1">
					<Scale class="w-3 h-3" /> Paired Net Uplift
				</div>
				<div class="text-xl font-bold text-foreground">{pairedNetUplift.mean} pp</div>
				<div class="text-[10px] uppercase tracking-widest">
					n={pairedNetUplift.count}
				</div></CardContent
			></Card
		>
		<Card class="bg-emerald-500/5 shadow-none border-emerald-500/20"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1">Trust-Efficiency</div>
				<div class="text-xl font-bold text-emerald-500">{trustEfficiencySummary.gain}%</div>
				<div class="text-[10px] uppercase tracking-widest">
					Full {trustEfficiencySummary.full} · RAG {trustEfficiencySummary.rag}
				</div></CardContent
			></Card
		>
		<Card class="bg-sky-500/5 shadow-none border-sky-500/20"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1 flex items-center gap-1">
					<Target class="w-3 h-3" /> Middle Recovery
				</div>
				<div class="text-xl font-bold text-sky-500">{middleRecovery.value}%</div>
				<div class="text-[10px] uppercase tracking-widest">
					n={middleRecovery.count}
				</div></CardContent
			></Card
		>
		<Card class="bg-teal-500/5 shadow-none border-teal-500/20"
			><CardContent class="p-4"
				><div class="text-[10px] uppercase tracking-widest mb-1">Noise-Slope Cut</div>
				<div class="text-xl font-bold text-teal-500">{noiseSlopeReduction}%</div></CardContent
			></Card
		>
	</div>

	<div class="space-y-4">
		<h3
			class="text-sm font-bold uppercase tracking-widest border-b border-border pb-2 flex items-center gap-2 text-foreground"
		>
			<TrendingUp class="w-4 h-4 text-muted-foreground" /> Pipeline Matrix (All Runs)
		</h3>
		<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
			{#each grouped as item}
				<div class="border border-border bg-card p-3 space-y-2">
					<div class="text-xs font-bold uppercase tracking-widest text-foreground">
						{item.family}
					</div>
					<div class="text-[10px] uppercase tracking-widest text-muted-foreground">
						{item.pipeline}
					</div>
					<Progress value={item.avgConfidence} max={100} class="h-2" />
					<div class="text-[10px] uppercase tracking-widest">
						Conf {item.avgConfidence}% · Hall {item.avgHall} · {item.avgLatency}ms · n={item.runs}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="space-y-4">
		<h3
			class="text-sm font-bold uppercase tracking-widest border-b border-border pb-2 text-foreground"
		>
			Rank Stability
		</h3>
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
			{#each rankStability as item}
				<div class="border border-border bg-card p-3 space-y-2">
					<div class="text-xs font-bold uppercase tracking-widest text-foreground">
						{item.mode}
					</div>
					<Progress value={item.winProbability} max={100} class="h-2" />
					<div class="text-[10px] uppercase tracking-widest">
						Win probability {item.winProbability}%
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="space-y-4">
		<h3
			class="text-sm font-bold uppercase tracking-widest border-b border-border pb-2 text-foreground"
		>
			Positional Bias Heatmap (Current Session RAG)
		</h3>
		<div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
			{#each currentHeatmap as cell}
				<div
					class="border border-border p-2 text-center"
					style={`background-color: rgba(245, 158, 11, ${Math.max(0.1, cell.intensity / 100)});`}
				>
					<div class="text-[10px] font-bold">{cell.label}</div>
					<div class="text-xs">{cell.hits}</div>
				</div>
			{/each}
		</div>
		{#if currentHeatmap.length === 0}
			<div class="text-xs uppercase tracking-widest text-muted-foreground">
				Run at least one RAG query to see heatmap.
			</div>
		{/if}
	</div>
</div>
