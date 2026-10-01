export interface Segment { start: number | null; end: number | null; text: string }
export interface Video { id: string; title: string; channel: string; duration: number; time: number; dark: boolean; theatre: boolean }
export interface Transcript { segments: Segment[]; source: 'youtube' | 'pasted'; complete: boolean; detail: string }
export interface Comment { id: string; author: string; text: string; likes: string; url: string }
export interface CommentSet { items: Comment[]; complete: boolean; detail: string }
export interface Source { title: string; url: string }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; sources?: Source[]; incomplete?: boolean }
export interface Note { id: string; videoId: string; videoTitle: string; time: number | null; title: string; body: string; image?: string; sources?: Source[]; createdAt: number; kind: 'note' | 'screenshot' | 'bookmark' | 'quiz' | 'flashcards' }
export interface Sponsor { start: number; end: number; confidence: 'clear' | 'uncertain'; reason: string }
export interface DetectedObject { name: string; description: string }
export interface AIResult { text: string; sources: Source[]; searchUsed: boolean; tokens: number; finishReason?: string; searchSuggestions?:string }
export type AIKind = 'recommend' | 'chat' | 'summary' | 'explain' | 'check' | 'comments' | 'comment-question' | 'capture-plan' | 'visual-note' | 'objects' | 'product' | 'sponsors' | 'quiz' | 'flashcards';
export interface AIRequest { kind: AIKind; video: Video; transcript: Transcript; question?: string; history?: Message[]; comments?: CommentSet; image?: string; selection?: string; commentEvidence?:string }
export interface Settings { model: string; firebaseApiKey: string; googleClientId: string; rememberKey: boolean; hasKey: boolean }
export interface PublicUser { name: string; email: string }
export interface Snapshot { video?: Video; active: boolean; user?: PublicUser; settings: Settings; transcript?: Transcript; comments?: CommentSet; messages: Message[]; notes: Note[]; sources: Source[]; tokens: number; recommendations?: string[] }
export interface MediaFormat { itag: number; url?: string; mimeType: string; qualityLabel?: string; width?: number; height?: number; bitrate?: number; audioQuality?: string; contentLength?: string; signatureCipher?: string; cipher?: string }
export interface MediaInfo { videoId: string; formats: MediaFormat[]; live: boolean; reason?: string }
export type PageCommand = 'context' | 'transcript' | 'comments' | 'seek' | 'capture' | 'capture-at' | 'speed' | 'loop' | 'focus' | 'sponsors' | 'activation' | 'cancel' | 'caption-tip';
export type RpcMessage = { id: string; action: string; payload?: any };
export type RpcEvent = { id?: string; ok?: boolean; data?: any; error?: string; event?: string };
