<script lang="ts">
	import { Cpu } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';

	let { onNewSession } = $props<{ onNewSession?: () => void }>();
</script>

<header
	class="border-b-2 sm:border-b-4 border-border p-3 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-card shrink-0"
>
	<div class="flex items-center gap-2 sm:gap-3 min-w-0">
		<Cpu class="w-6 h-6 sm:w-8 sm:h-8 text-primary shrink-0" />
		<h1 class="text-lg sm:text-2xl font-black uppercase tracking-tighter text-foreground truncate">
			Hallucinate<span class="text-primary">.</span>
		</h1>
	</div>
	<div
		class="w-full sm:w-auto flex gap-2 sm:gap-4 text-sm font-bold items-center justify-between sm:justify-end"
	>
		<div
			class="px-2 sm:px-4 py-1.5 sm:py-2 border border-border sm:border-2 text-muted-foreground bg-background flex items-center gap-2 hidden md:flex text-[10px] sm:text-xs tracking-wider font-bold"
		>
			<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
			SYSTEM ONLINE
		</div>
		<Button
			variant="default"
			onclick={onNewSession}
			class="uppercase whitespace-nowrap text-[10px] sm:text-xs font-black tracking-wide sm:tracking-wider border border-transparent sm:border-2 shadow-none sm:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)] hover:translate-y-0 sm:hover:translate-y-[2px] hover:translate-x-0 sm:hover:translate-x-[2px] sm:hover:shadow-[2px_2px_0px_0px_rgba(255,255,255,0.2)] transition-all"
		>
			New Session
		</Button>
	</div>
</header>
