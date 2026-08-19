<script lang="ts">
	/**
	 * Оболочка для жанровых пиктограмм.
	 *
	 * Сам рисунок жанра остаётся штриховым, а вокруг него появляется общий для
	 * всей системы знак — «апертура»: тонкое кольцо и едва заметный ромб света.
	 * Так пиктограммы выглядят частью КИНЕМЫ, а не набором разрозненных SVG.
	 */
	import {
		faBolt,
		faComments,
		faCompass,
		faEye,
		faFaceLaughBeam,
		faFilm,
		faFingerprint,
		faGhost,
		faHatCowboy,
		faHatWizard,
		faHeart,
		faHeartCrack,
		faLandmark,
		faMagnifyingGlass,
		faMasksTheater,
		faMusic,
		faNewspaper,
		faPeopleRoof,
		faPuzzlePiece,
		faRocket,
		faShieldHalved,
		faTowerBroadcast,
		faTv,
		faVideo,
		faWandMagicSparkles,
		type IconDefinition
	} from '@fortawesome/free-solid-svg-icons';
	import { genreIcon } from '$lib/genreIcons';

	type Variant = 'tile' | 'chip' | 'inline';

	interface Props {
		id: number;
		size?: number | string;
		variant?: Variant;
		class?: string;
	}

	const ICONS: Record<string, IconDefinition> = {
		genreAction: faBolt,
		compass: faCompass,
		genreAnimation: faWandMagicSparkles,
		genreComedy: faFaceLaughBeam,
		genreCrime: faFingerprint,
		genreDocumentary: faVideo,
		genreDrama: faMasksTheater,
		genreFamily: faPeopleRoof,
		genreFantasy: faHatWizard,
		genreHistory: faLandmark,
		genreHorror: faGhost,
		genreMusic: faMusic,
		genreMystery: faMagnifyingGlass,
		genreRomance: faHeart,
		genreScifi: faRocket,
		v: faTv,
		tv: faTv,
		genreThriller: faEye,
		genreWar: faShieldHalved,
		genreWestern: faHatCowboy,
		genreKids: faPuzzlePiece,
		genreNews: faNewspaper,
		genreReality: faTowerBroadcast,
		genreSoap: faHeartCrack,
		genreTalk: faComments,
		film: faFilm
	};

	let { id, size = 16, variant = 'inline', class: cls = '' }: Props = $props();
	const name = $derived(genreIcon(id));
	const definition = $derived(ICONS[name] ?? faFilm);
	const [width, height, , , path] = $derived(definition.icon);
	const paths = $derived(Array.isArray(path) ? path : [path]);
</script>

<span class="genre-mark genre-mark--{variant} {cls}" aria-hidden="true">
	<svg
		viewBox="0 0 {width} {height}"
		width={size}
		height={size}
		fill="currentColor"
		class="relative z-[1]"
		focusable="false"
	>
		{#each paths as d (d)}
			<path {d} />
		{/each}
	</svg>
</span>
