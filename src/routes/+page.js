import catalog from '$lib/data/catalogData';
import { initProskomma } from '$lib/data/scripture';
import { refs } from '$lib/data/stores/scripture';
import { get } from 'svelte/store';

/** @type {import('./$types').PageLoad} */
export async function load({ url, fetch }) {
    const ref = url.searchParams.get('ref');
    const audio = url.searchParams.get('audio');
    const proskomma = await initProskomma({ fetch });

    if (!get(refs).inititialized) {
        catalog.setFetch(fetch);
        await refs.init();
    }

    return { ref, audio, proskomma };
}
