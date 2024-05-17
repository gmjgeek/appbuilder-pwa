import { pk } from '$lib/data/stores/pk';
import type { Proskomma } from 'proskomma-core';
import { get } from 'svelte/store';

let fetchFn = fetch;

export interface CatalogData {
    id: string;
    selectors: { lang: string; abbr: string };
    hasMapping: boolean;
    documents: {
        id: string;
        bookCode: string;
        h: string;
        toc: string;
        toc2: string;
        toc3: string;
        sequences: {}[];
        hasIntroduction: boolean;
        versesByChapters: {
            [chapter: string]: {
                [verse: string]: string;
            };
        };
    }[];
    tags: {};
}

export async function loadCatalog(docSet: string): Promise<CatalogData> {
    const proskomma = get(pk) as Proskomma;
    const rawCatalog = await proskomma.gqlQuery(catalogQuery({ cv: true }));
    const catalog = parseChapterVerseMapInDocSets({
        docSets: [rawCatalog.data.docSets[0]]
    })[0];
    return catalog as CatalogData;
}

const catalogQuery = ({ cv }: { cv: any }) => `{
    nDocSets nDocuments
    docSets {
      id
      tagsKv { key value }
      selectors { key value }
      hasMapping
      documents (
        sortedBy: "paratext"
      ) {
        id
        bookCode: header(id:"bookCode")
        h: header(id:"h")
        toc: header(id:"toc")
        toc2: header(id:"toc2")
        toc3: header(id:"toc3")
        ${
            cv
                ? `
            sequences(types:"introduction") { id }
            cvNumbers: cvIndexes {
              chapter
              verses: verseNumbers {
                number
                range
              }
            }
          `
                : ''
        }
      }
    }
  }`;

type docSetType = {
    id: string;
    tagsKv: { [key: string]: string };
    selectors: { [key: string]: string };
    documents: [any];
    sequences: { id: string };
};
type docSetsType = {
    docSets: [docSetType];
};
const parseChapterVerseMapInDocSets = (_ref: docSetsType) => {
    const { docSets: _docSets } = _ref;
    const docSets = _docSets?.length > 0 ? JSON.parse(JSON.stringify(_docSets)) : [];

    docSets?.forEach((docSet: any) => {
        if (docSet?.selectors?.forEach) {
            const selectors: { [key: string]: string } = {};

            docSet.selectors.forEach(({ key, value }: { [key: string]: string }) => {
                selectors[key] = value;
            });
            docSet.selectors = selectors;
        }

        if (docSet?.tagsKv?.forEach) {
            const tags: { [key: string]: string } = {};

            docSet.tagsKv.forEach(({ key, value }: { [key: string]: string }) => {
                tags[key] = value;
            });
            delete docSet.tagsKv;
            docSet.tags = tags;
        }

        docSet.documents.forEach((document: any) => {
            let introductions = false;
            if (document?.sequences?.length > 0) {
                introductions = true;
            }
            document.hasIntroduction = introductions;
            if (document?.cvNumbers) {
                const chaptersVersesObject: { [chapter: string]: any } = {};

                document?.cvNumbers?.forEach(({ chapter, verses }: { [chapter: string]: any }) => {
                    const versesObject: { [number: string]: number } = {};

                    verses.forEach(({ number, range }: { [number: string]: number }) => {
                        versesObject[number] = range;
                    });
                    chaptersVersesObject[chapter] = versesObject;
                });

                delete document.cvNumbers;
                document.versesByChapters = chaptersVersesObject;
            }
        });
    });

    return docSets;
};

export default {
    setFetch: (func) => {
        fetchFn = func;
    }
};
