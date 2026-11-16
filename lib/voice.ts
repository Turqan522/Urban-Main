import type { Sos } from "./crisis/types";
export function classifyVoice(text: string): Sos["type"] | null {
    const value = text.toLocaleLowerCase("az").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    // Specific hazards precede generic help words.
    if (/yan[gğ]ın|yangin|fire/.test(value))
        return "fire";
    if (/dagıntı|daginti|collapse|komək|komek/.test(value))
        return "collapse";
    if (/su basması|su basmasi|flood/.test(value))
        return "flood";
    if (/həkim|hekim|tibbi|medical|help/.test(value))
        return "medical";
    return null;
}
export type SpeechInstance = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: {
        results: {
            [index: number]: {
                [index: number]: {
                    transcript: string;
                };
            };
        };
    }) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    start(): void;
    abort(): void;
};
export function speechConstructor(): (new () => SpeechInstance) | undefined {
    const w = window as unknown as {
        SpeechRecognition?: new () => SpeechInstance;
        webkitSpeechRecognition?: new () => SpeechInstance;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
