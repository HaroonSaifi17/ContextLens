<script lang="ts">
	import {
		Upload,
		FileText,
		Send,
		LoaderCircle,
		FlaskConical,
		WandSparkles,
		Rows3
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Card } from '$lib/components/ui/card';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type { SessionSummary } from '$lib/types';

	let {
		query = $bindable(),
		session,
		statusText = '',
		isUploading = false,
		isAnalyzing = false,
		isGeneratingQueries = false,
		noiseInjection = false,
		onUpload,
		onPasteText,
		onToggleNoise,
		onRunQuery,
		onGenerateQueries,
		onRunResearchBatch,
		onRemoveDocument
	} = $props<{
		query: string;
		session: SessionSummary | null;
		statusText?: string;
		isUploading?: boolean;
		isAnalyzing?: boolean;
		isGeneratingQueries?: boolean;
		noiseInjection?: boolean;
		onUpload?: (file: File) => void | Promise<void>;
		onPasteText?: (text: string, title: string) => void | Promise<void>;
		onToggleNoise?: () => void;
		onRunQuery?: () => void;
		onGenerateQueries?: () => void;
		onRunResearchBatch?: () => void;
		onRemoveDocument?: () => void;
	}>();

	let fileInput = $state<HTMLInputElement | null>(null);
	let loadingSample = $state<string | null>(null);
	let pastedTitle = $state('pasted_notes.txt');
	let pastedText = $state('');
	let isDragOver = $state(false);

	const sampleDocuments = [
		{
			id: 'alice',
			label: 'Alice Story',
			filename: 'alice_in_wonderland.pdf',
			url: '/samples/alice_in_wonderland.pdf'
		},
		{
			id: 'gatsby',
			label: 'Great Gatsby',
			filename: 'great_gatsby.pdf',
			url: '/samples/great_gatsby.pdf'
		},
		{
			id: 'anne-frank',
			label: 'Anne Frank',
			filename: 'anne_frank.pdf',
			url: '/samples/anne_frank.pdf'
		}
	] as const;

	const displayTitle = $derived.by(() => {
		if (!session) return '';
		return session.title?.trim() || session.filename;
	});

	const visiblePreview = $derived.by(() => {
		if (!session?.previewText) return '';
		const text = session.previewText.trim();
		if (text.length <= 1200) return text;
		return `${text.slice(0, 700).trim()}\n\n... [middle content hidden for readability] ...\n\n${text.slice(-350).trim()}`;
	});

	function openPicker() {
		fileInput?.click();
	}

	async function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file && onUpload) await onUpload(file);
		input.value = '';
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		const file = event.dataTransfer?.files?.[0];
		if (file && onUpload) await onUpload(file);
	}

	async function handleSampleClick(sample: (typeof sampleDocuments)[number]) {
		if (!onUpload) return;
		loadingSample = sample.id;
		try {
			const response = await fetch(sample.url);
			if (!response.ok) throw new Error('Failed to load sample document.');
			const blob = await response.blob();
			await onUpload(new File([blob], sample.filename, { type: 'application/pdf' }));
		} finally {
			loadingSample = null;
		}
	}

	async function handlePasteSubmit() {
		if (!onPasteText || !pastedText.trim()) return;
		await onPasteText(pastedText, pastedTitle || 'pasted_notes.txt');
	}
</script>

<div class="h-full min-h-0 flex flex-col bg-background lg:border-r-4 border-border overflow-hidden">
	<div
		class={`p-3 sm:p-4 border-b-2 sm:border-b-4 border-border bg-card space-y-3 ${!session ? 'flex-1 min-h-0 overflow-y-auto' : 'shrink-0'}`}
	>
		{#if !session && statusText}<div
				class="p-2 border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest"
			>
				{statusText}
			</div>{/if}

		{#if !session}
			<div class="space-y-2">
				<div class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
					Try sample papers
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
					{#each sampleDocuments as sample}
						<button
							onclick={() => handleSampleClick(sample)}
							disabled={isUploading || isAnalyzing || loadingSample !== null}
							class="text-xs font-bold uppercase tracking-wide border border-border bg-background p-2 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
						>
							{#if loadingSample === sample.id}
								<LoaderCircle class="w-3.5 h-3.5 animate-spin mx-auto" />
							{:else}
								{sample.label}
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<input
				bind:this={fileInput}
				type="file"
				accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf"
				class="hidden"
				onchange={handleFileChange}
			/>
			<div
				role="button"
				tabindex="0"
				ondragover={(event) => {
					event.preventDefault();
					isDragOver = true;
				}}
				ondragleave={() => (isDragOver = false)}
				ondrop={handleDrop}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') openPicker();
				}}
				class={`border-2 border-dashed p-4 flex flex-col items-center justify-center gap-2 transition-all ${isDragOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/40 bg-muted/30'}`}
			>
				<Button
					onclick={openPicker}
					disabled={isUploading}
					class="w-full uppercase text-xs font-bold"
				>
					{#if isUploading}<LoaderCircle class="w-4 h-4 animate-spin" />{:else}<Upload
							class="w-4 h-4"
						/>{/if}
					{isUploading ? 'Uploading...' : 'Drop or upload document'}
				</Button>
				<div class="text-[10px] text-muted-foreground uppercase tracking-widest">
					PDF/TXT/MD up to 20MB
				</div>
			</div>

			<div class="space-y-2 border border-border bg-muted/20 p-2 sm:p-3">
				<div class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
					Or paste text
				</div>
				<Input bind:value={pastedTitle} placeholder="document name" class="text-xs h-8" />
				<textarea
					bind:value={pastedText}
					placeholder="Paste text here..."
					class="w-full h-14 sm:h-16 resize-none bg-background border border-border p-2 text-xs"
				></textarea>
				<Button
					variant="outline"
					onclick={handlePasteSubmit}
					disabled={!pastedText.trim() || isUploading || isAnalyzing}
					class="w-full uppercase text-xs font-bold">Use pasted text</Button
				>
			</div>
		{:else}
			<Card
				class="flex items-center gap-3 p-3 bg-emerald-500/5 border-2 border-emerald-500/30 shadow-none"
			>
				<div class="flex flex-1 min-w-0 items-center gap-3">
					<div class="p-2 bg-emerald-500/10 border-2 border-emerald-500/20">
						<FileText class="w-4 h-4 text-emerald-500" />
					</div>
					<div class="min-w-0 flex-1 overflow-hidden">
						<h2
							title={displayTitle}
							class="block max-w-full font-bold text-xs text-foreground tracking-wide leading-tight whitespace-normal break-words [overflow-wrap:anywhere]"
						>
							{displayTitle}
						</h2>
						<span class="text-[10px] text-muted-foreground font-bold">Parsed and indexed</span>
					</div>
				</div>
				<Button
					variant="outline"
					size="sm"
					onclick={onRemoveDocument}
					disabled={isAnalyzing}
					class="shrink-0 text-xs font-bold uppercase">Remove</Button
				>
			</Card>
		{/if}

		<div class="border border-border bg-muted/20 p-2 flex items-center justify-between">
			<div
				class="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-2"
			>
				<FlaskConical class="w-3.5 h-3.5" /> Noise Lab
			</div>
			<Button
				variant="outline"
				size="sm"
				onclick={onToggleNoise}
				class="uppercase text-xs font-bold">{noiseInjection ? 'Noise On' : 'Noise Off'}</Button
			>
		</div>
	</div>

	{#if session}
		<ScrollArea class="flex-1 min-h-0 p-3 sm:p-4">
			<div class="h-full min-h-0 flex flex-col gap-3 text-muted-foreground leading-relaxed text-sm">
				{#if statusText}<div
						class="p-2 border border-primary/30 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest"
					>
						{statusText}
					</div>{/if}
				<div class="flex-1 min-h-0 p-3 border-l-4 border-primary bg-muted/50">
					<p
						class="h-full overflow-y-auto text-foreground font-medium bg-primary/10 p-2 border border-primary/20 whitespace-pre-wrap break-words text-xs"
					>
						{visiblePreview}
					</p>
				</div>
				<p class="mt-auto pt-1 opacity-50 italic text-center font-bold text-xs">
					Preview uses start+end snippet for readability.
				</p>
			</div>
		</ScrollArea>
	{/if}

	<div class="p-3 border-t-2 sm:border-t-4 border-border bg-card shrink-0">
		<div class="space-y-2">
			<textarea
				placeholder="ENTER QUERY OR ONE BATCH QUERY PER LINE..."
				class="w-full font-mono text-sm bg-background border-2 border-border focus-visible:ring-primary shadow-inner h-16 sm:h-20 font-bold placeholder:text-muted-foreground p-3 resize-none"
				bind:value={query}
				disabled={isAnalyzing}
				onkeydown={(event) => {
					if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onRunQuery?.();
				}}
			></textarea>
			<div class="grid grid-cols-1 2xl:grid-cols-3 gap-2">
				<Button
					variant="outline"
					disabled={!session || isAnalyzing || isGeneratingQueries}
					onclick={onGenerateQueries}
					class="font-black uppercase tracking-wider px-2 min-h-10 sm:min-h-11 h-auto border-2 transition-all disabled:shadow-none disabled:opacity-50 text-[10px] sm:text-xs whitespace-normal leading-tight"
				>
					{#if isGeneratingQueries}<LoaderCircle class="w-4 h-4 animate-spin" />{:else}<WandSparkles
							class="w-4 h-4"
						/>{/if}
					Generate
				</Button>
				<Button
					variant="outline"
					disabled={!session || !query || isAnalyzing}
					onclick={onRunResearchBatch}
					class="font-black uppercase tracking-wider px-2 min-h-10 sm:min-h-11 h-auto border-2 transition-all disabled:shadow-none disabled:opacity-50 text-[10px] sm:text-xs whitespace-normal leading-tight"
				>
					{#if isAnalyzing}<LoaderCircle class="w-4 h-4 animate-spin" />{:else}<Rows3
							class="w-4 h-4"
						/>{/if}
					Batch
				</Button>
				<Button
					disabled={!session || !query || isAnalyzing}
					onclick={onRunQuery}
					class="font-black uppercase tracking-wider px-2 min-h-10 sm:min-h-11 h-auto border-2 border-transparent transition-all disabled:shadow-none disabled:opacity-50 text-[10px] sm:text-xs whitespace-normal leading-tight"
				>
					{#if isAnalyzing}<LoaderCircle class="w-4 h-4 animate-spin" />{:else}<Send
							class="w-4 h-4"
						/>{/if}
					Single
				</Button>
			</div>
		</div>
	</div>
</div>
