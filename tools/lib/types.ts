// Hand-mirrored from schema/performance.schema.json (the schema is the contract;
// these types exist for tooling ergonomics).

export interface SfxCue {
  audio: string;
  at_ms: number;
}

export interface Beat {
  index: number;
  character_id: string;
  expression: string;
  /** Overrides the role's cast layers for this beat only, slot by slot. */
  layers?: Layers;
  text: string;
  line_audio: string | null;
  sfx: SfxCue[];
  duration_ms: number;
  animation: "speak" | "none" | "enter";
  device?: string;
}

export type LayerSlot = "back_prop" | "costume" | "headwear" | "front_prop";

export type Layers = Partial<Record<LayerSlot, string | null>>;

export interface CastMember {
  character_id: string;
  display_name: string;
  actor: string;
  voice: string;
  layers?: Layers;
  default_expression: string;
}

export interface ActorAssets {
  id: string;
  base_uri: string;
  expressions: Record<string, string>;
}

export interface AudioAsset {
  id: string;
  kind: "line" | "sfx";
  uri: string;
  format: "wav";
  duration_ms: number;
}

export interface AssetManifest {
  actors: ActorAssets[];
  audio: AudioAsset[];
}

export interface Stage {
  devices: string[];
  default_device: string;
}

export interface Performance {
  schema_version: 2;
  id: string;
  title: string;
  cast: CastMember[];
  assets: AssetManifest;
  timeline: Beat[];
  stage: Stage;
}

export interface TroupeLayer {
  id: string;
  slot: LayerSlot;
  fits: string[]; // actor ids and/or categories ("human" | "animal")
  description: string;
}

export interface Troupe {
  schema_version: 1;
  actors: { id: string; name: string; category: "human" | "animal"; voice: string }[];
  mc: { id: string; name: string; voice: string };
  expressions: { base: string[]; miss_moon: string[] };
  layers: TroupeLayer[];
  sfx_vocabulary: string[];
  sfx_catalog: { id: string; sound: string; use: string; avoid: string }[];
  voices: { id: string; description: string }[];
}
