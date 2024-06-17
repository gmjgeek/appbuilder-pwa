import type { SABProskomma } from '$lib/sab-proskomma';
import {
    SearchInterface,
    SearchQueryBase,
    type SearchCandidate,
    type SearchOptions
} from './application';
import { BufferedReader } from './utils/buffered-reader';
import { RegexHelpers, makeRegexPattern } from './utils/regex-helpers';
import config from '$lib/data/config';
import { extendStringProperty } from './utils/object-helpers';

export interface GQLBooks {
    data: {
        docSet: {
            documents: {
                id: string;
                idParts: {
                    type: string;
                };
            }[];
        };
    };
}

export interface GQLBlockToken {
    scopes: string[];
    payload: string;
}

export interface GQLBlocks {
    data: {
        document: {
            bookCode: string;
            mainSequence: {
                blocks: {
                    tokens: GQLBlockToken[];
                }[];
            };
        };
    };
}

function keywordToRegex(
    word: string,
    wholeWords: boolean = false,
    ignore: string = '',
    substitute: { [char: string]: string } = {}
) {
    let pattern = word;
    pattern = makeRegexPattern(pattern, { ignore, substitute });
    pattern = pattern.replaceAll('\\', '\\\\');
    pattern = pattern.replaceAll('"', '\\"');
    if (wholeWords) {
        pattern = '^' + pattern + '$';
    }
    return pattern;
}

function searchParams(
    keywords: string[],
    wholeWords: boolean = false,
    ignore: string = '',
    substitute: { [char: string]: string }
): string {
    const terms = keywords.map((w) => keywordToRegex(w, wholeWords, ignore, substitute));
    return `withMatchingChars: ["${terms.join('", "')}"]`;
}

/**
 * Get a chapter/verse reference string from Proskomma scopes
 */
function chapterVerseFromScopes(scopes: string[]): string {
    let verse: string;
    let chapter: string;
    for (const s of scopes) {
        if (s.startsWith('chapter/')) {
            chapter = s.split('/')[1];
        } else if (s.startsWith('verses/')) {
            verse = s.split('/')[1];
        }
    }
    let ref = chapter;
    if (verse) {
        ref += ':' + verse;
    }
    return ref;
}

export const gqlSearchHelpers = {
    keywordToRegex,
    chapterVerseFromScopes
};

class ProskommaVerseProvider extends SearchInterface.VerseProvider {
    constructor(args: {
        pk: SABProskomma;
        searchPhrase: string;
        wholeWords: boolean;
        ignore?: string;
        substitute?: { [char: string]: string };
        docSet: string;
        collection: string;
    }) {
        super(args.searchPhrase, {});
        this.pk = args.pk;
        this.docSet = args.docSet;
        this.collection = args.collection;

        const tokens = RegexHelpers.wordsOf(args.searchPhrase);
        this.searchIsBlank = tokens.length === 0;

        this.searchParams = searchParams(tokens, args.wholeWords, args.ignore, args.substitute);
    }

    pk: SABProskomma;
    books: string[];
    nextBook: number;
    searchParams: string;
    searchIsBlank: boolean;

    docSet: string;
    collection: string;

    private verseReader = new BufferedReader({
        read: () => this.queryNextBook(),
        done: () => this.nextBook >= this.books.length
    });

    async getVerses(limit: number = 0): Promise<SearchCandidate[]> {
        if (this.searchIsBlank) return [];
        await this.ensureBooksSet();
        return await this.verseReader.read(limit);
    }

    async queryNextBook(): Promise<SearchCandidate[]> {
        await this.ensureBooksSet();
        if (this.nextBook >= this.books.length) {
            return [];
        }
        const book = this.books[this.nextBook];
        this.nextBook++;
        return this.versesOfBook(book);
    }

    private async ensureBooksSet() {
        if (this.books == undefined) {
            await this.setBooks();
        }
    }

    async setBooks() {
        this.nextBook = 0;
        const queryData = await this.queryForBooks();
        this.books = queryData.data.docSet.documents
            .filter((bk) => bk.idParts.type === 'book')
            .map((bk) => bk.id);
    }

    async versesOfBook(bookId: string): Promise<SearchCandidate[]> {
        const queryData = await this.queryForBlocks(bookId);
        const bookCode = queryData.data.document.bookCode;
        const tokens = queryData.data.document.mainSequence.blocks
            .map((block) => block.tokens)
            .flat();
        return this.versesFromTokens(tokens, bookCode);
    }

    versesFromTokens(tokens: GQLBlockToken[], bookCode: string): SearchCandidate[] {
        const verseTexts = this.collectVerseTexts(tokens);
        return Object.keys(verseTexts).map((cv) => {
            const ref = cv.split(':');
            return {
                reference: {
                    docSet: this.docSet,
                    collection: this.collection,
                    bookCode,
                    chapter: ref[0],
                    verses: ref[1]
                },
                text: verseTexts[cv]
            };
        });
    }

    private collectVerseTexts(tokens: GQLBlockToken[]): { [verse: string]: string } {
        return tokens.reduce((verses, token) => {
            const ref = chapterVerseFromScopes(token.scopes);
            if (!verses[ref]) verses[ref] = '';
            verses[ref] += token.payload;
            return verses;
        }, {});
    }

    async queryForBooks(): Promise<GQLBooks> {
        return (await this.pk.gqlQuery(`
            {
                docSet(id: "${this.docSet}") {
                    documents(${this.searchParams} allChars: true sortedBy: "paratext") {
                        id
                        idParts {
                            type
                        }
                    }
                }
            }
        `)) as GQLBooks;
    }

    async queryForBlocks(bookId: string): Promise<GQLBlocks> {
        return (await this.pk.gqlQuery(`
            {
                document(id: "${bookId}") {
                    bookCode: header(id: "bookCode")
                    mainSequence {
                        blocks(${this.searchParams} allChars: true) {
                            tokens(includeContext: true) {
                                scopes(startsWith: ["chapter/" "verses/"])
                                payload
                            }
                        }
                    }
                }
            }
        `)) as GQLBlocks;
    }
}

interface SearchConfig {
    ignore?: string;
    substitute?: { [char: string]: string };
}

function getConfig(): SearchConfig {
    return parseConfig(config.mainFeatures['search-accents-to-remove']);
}

function parseConfig(accentsToRemove: string): SearchConfig {
    const ignore = parseIgnored(accentsToRemove);
    const substitute = parseSubstitutes(accentsToRemove);
    return { ignore, substitute };
}

function parseSubstitutes(accentsToRemove: string) {
    const sub = {};
    for (const match of accentsToRemove.matchAll(/(\S)>(\S)/g)) {
        extendStringProperty(sub, match[1], match[2]);
        extendStringProperty(sub, match[2], match[1]);
    }
    return sub;
}

function parseIgnored(accentsToRemove: string) {
    let ignore = '';
    for (const c of accentsToRemove.matchAll(/\\u(03\d\d)/g)) {
        const codePoint = parseInt(c[1], 16);
        const char = String.fromCodePoint(codePoint);
        ignore += char;
    }
    return ignore;
}

export const ProksommaSearchInterface = { ProskommaVerseProvider, parseConfig };

/**
 * Implements search queries using Proskomma
 */
export class SearchQuery extends SearchQueryBase {
    constructor(
        searchPhrase: string,
        pk: SABProskomma,
        docSet: string,
        collection: string,
        options: SearchOptions
    ) {
        const configOptions = getConfig();
        const verseProvider = new ProskommaVerseProvider({
            pk,
            searchPhrase,
            wholeWords: options.wholeWords,
            ignore: configOptions.ignore,
            substitute: configOptions.substitute,
            docSet,
            collection
        });
        options.substitute = configOptions.substitute;
        options.ignore = configOptions.ignore;
        super(searchPhrase, verseProvider, options);
    }
}
