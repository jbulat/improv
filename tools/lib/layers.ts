// Resolving what a character actually wears on a given beat.
//
// A role's layers live on its cast entry — the costume it wears throughout.
// A beat may override them slot by slot, which is how a story stages a reveal
// (Tuk introduces himself bare-headed, then puts the horns on for "DRAGON!").
// An explicit null in a beat's override strips a slot the cast wears; a slot
// the beat doesn't mention keeps whatever the cast has on.
import type { Beat, CastMember, LayerSlot, Layers } from "./types";

/** The populated slots of one layer set, in no particular order. */
export function wornSlots(layers: Layers | undefined): [LayerSlot, string][] {
  return Object.entries(layers ?? {}).filter(([, id]) => id != null) as [LayerSlot, string][];
}

/** What `member` wears during `beat`: the cast set, with the beat's override
 *  merged over it. Only populated slots survive. */
export function effectiveLayers(
  member: Pick<CastMember, "layers"> | undefined,
  beat: Pick<Beat, "layers">,
): Layers {
  const merged: Layers = { ...(member?.layers ?? {}), ...(beat.layers ?? {}) };
  return Object.fromEntries(wornSlots(merged));
}
