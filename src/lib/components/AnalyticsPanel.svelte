<script lang="ts">
	import { BarChart3, TrendingUp, ShieldAlert, Flame, Download } from 'lucide-svelte';
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
		<Button
			variant="outline"
			onclick={exportReport}
			class="uppercase font-bold text-xs tracking-widest w-full sm:w-auto"
		>
			<Download class="w-4 h-4" /> Export Report
		</Button>
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
