<script lang="ts">
	import { party } from '$lib/party.svelte';
	import { stickerById } from '$lib/party-media';
	function left(id: string) {
		let hash = 0;
		for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
		return 18 + hash % 64;
	}
</script>

{#if party.reactions.length}
	<div class="reactions" aria-label="Реакции участников" aria-live="polite">
		{#each party.reactions as reaction (reaction.id)}
			{@const sticker = stickerById(reaction.stickerId)}
			<div class="reaction" class:sticker={!!sticker} style:left={`${left(reaction.id)}%`}>
				{#if sticker}<img src={sticker.src} alt={sticker.label} width="120" height="140" />{:else}<span class="text-3xl drop-shadow-lg">{reaction.emoji}</span>{/if}
				<span class="mt-0.5 max-w-24 truncate text-[10px] text-white/80">{reaction.name}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.reactions { position: absolute; inset: 0; z-index: 35; overflow: hidden; pointer-events: none; }
	.reaction { position: absolute; bottom: min(25%, 140px); display: flex; flex-direction: column; align-items: center; animation: float 1.9s ease-out both; }
	.reaction.sticker { animation-duration: 3.2s; margin-left: -60px; }
	.sticker img { width: 120px; height: 140px; object-fit: contain; filter: drop-shadow(0 4px 6px #0008); }
	@media (max-width: 639px) { .reaction.sticker { margin-left: -45px; } .sticker img { width: 90px; height: 110px; } }
	@keyframes float {
		0% { opacity: 0; transform: translateY(12px) scale(.7); }
		12% { opacity: 1; transform: translateY(0) scale(1); }
		75% { opacity: 1; }
		100% { opacity: 0; transform: translateY(-56px) scale(1.05); }
	}
	@media (prefers-reduced-motion: reduce) { .reaction { animation: none; } }
</style>
