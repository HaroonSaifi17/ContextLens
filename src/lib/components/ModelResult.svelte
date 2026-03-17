<script lang="ts">
	import { AlertCircle, CheckCircle2, Zap } from 'lucide-svelte';
	import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import type { PipelineRun } from '$lib/types';

	let { run } = $props<{ run: PipelineRun }>();

	const pipelineLabel = $derived.by(() => {
		if (run.pipeline === 'no_context') {
			return 'No Context';
		}
		if (run.pipeline === 'full_context') {
			return 'Full Document';
		}
		if (run.pipeline === 'rag') {
			return 'Smart Retrieval';
		}
		return run.pipeline;
	});

	const pipelineLetter = $derived.by(() => {
		if (run.pipeline === 'no_context') {
			return 'N';
		}
		if (run.pipeline === 'full_context') {
			return 'F';
		}
		if (run.pipeline === 'rag') {
			return 'R';
		}
		return 'B';
	});
</script>

<Card
	class="flex flex-col h-full bg-card hover:border-primary/50 transition-colors shadow-sm overflow-hidden"
>
	<CardHeader
		class="p-3 sm:p-4 border-b border-border bg-muted/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 space-y-0"
	>
		<div class="flex items-center gap-3">
			<div
				class="w-8 h-8 bg-primary/20 rounded-md flex items-center justify-center font-bold text-xs uppercase text-primary border border-primary/30"
			>
				{pipelineLetter}
			</div>
			<div>
				<CardTitle class="text-sm uppercase tracking-wider">{pipelineLabel}</CardTitle>
				<span class="text-[10px] text-muted-foreground uppercase tracking-widest"
					>{run.modelFamily} · {run.modelName}</span
				>
			</div>
		</div>
		<div class="flex gap-4 text-left sm:text-right w-full sm:w-auto">
			<div class="flex flex-col items-end">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider">Score</span>
				<span class="font-bold text-sm {run.confidence > 70 ? 'text-emerald-500' : 'text-primary'}"
					>{run.confidence}%</span
				>
			</div>
			<div class="flex flex-col items-end">
				<span class="text-[10px] text-muted-foreground uppercase tracking-wider">Latency</span>
				<span class="font-bold text-sm text-foreground">{(run.latencyMs / 1000).toFixed(2)}s</span>
			</div>
		</div>
	</CardHeader>

	<CardContent class="p-3 sm:p-5 text-sm leading-relaxed text-muted-foreground space-y-4 flex-1">
		<div class="space-y-2">
			{#each run.sentences as sentence}
				<div
					class={sentence.grounded
						? 'p-2 border border-emerald-500/20 bg-emerald-500/5'
						: 'p-2 border border-amber-500/30 bg-amber-500/10'}
				>
					<div class="text-foreground">{sentence.text}</div>
					<div class="text-[10px] uppercase tracking-widest mt-1 opacity-80">
						{sentence.grounded ? 'Grounded' : 'Possible Hallucination'} · {sentence.score}%
					</div>
				</div>
			{/each}
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] uppercase tracking-widest">
			<Badge variant="outline">Context: {run.contextChars} chars</Badge>
			<Badge variant="outline">Chunks: {run.contextChunks}</Badge>
			<Badge variant="outline">Coverage: {run.contextCoverage}%</Badge>
			<Badge variant="outline">Noise: {run.noiseInjected ? 'On' : 'Off'}</Badge>
		</div>

		{#if run.citations.length > 0}
			<div class="border-t border-border pt-3 space-y-2">
				<div class="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
					Citations
				</div>
				{#each run.citations as citation}
					<div class="text-xs border border-border bg-muted/20 p-2">
						<span class="text-primary font-bold">Chunk {citation.chunkOrder}:</span>
						{citation.text}
					</div>
				{/each}
			</div>
		{/if}
	</CardContent>

	<CardFooter
		class="p-3 border-t border-border bg-muted/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs font-bold uppercase tracking-widest"
	>
		{#if run.hallucinationCount === 0}
			<Badge
				variant="outline"
				class="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-mono tracking-wider gap-1.5 py-1"
			>
				<CheckCircle2 class="w-3.5 h-3.5" /> 0 Hallucinations
			</Badge>
		{:else}
			<Badge
				variant="outline"
				class="bg-amber-500/10 text-amber-500 border-amber-500/20 font-mono tracking-wider gap-1.5 py-1"
			>
				<AlertCircle class="w-3.5 h-3.5" />
				{run.hallucinationCount} Hallucination(s)
			</Badge>
		{/if}

		<div
			class="h-8 text-muted-foreground flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase"
		>
			<Zap class="w-3.5 h-3.5" /> Live Trace
		</div>
	</CardFooter>
</Card>
