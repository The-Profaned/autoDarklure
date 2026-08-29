/// <reference types="@deafwave/osrs-botmaker-types" />

import {
	onStart as uiOnStart,
	onEnd as uiOnEnd,
	getSearchRange,
	isUiCompleted,
} from './auto-darklure-ui.js';

// Each supported impling appearance has its own RuneLite NPC ID.
type ImplingType =
	| 'gourmet'
	| 'gourmet_2'
	| 'magpie'
	| 'magpie_2'
	| 'dragon'
	| 'dragon_2';

// Map readable impling names to the IDs used when querying nearby NPCs.
const IMPLING_IDS: Record<ImplingType, number> = {
	gourmet: net.runelite.api.NpcID.GOURMET_IMPLING,
	gourmet_2: net.runelite.api.NpcID.GOURMET_IMPLING_1647,
	magpie: net.runelite.api.NpcID.MAGPIE_IMPLING,
	magpie_2: net.runelite.api.NpcID.MAGPIE_IMPLING_1652,
	dragon: net.runelite.api.NpcID.DRAGON_IMPLING,
	dragon_2: net.runelite.api.NpcID.DRAGON_IMPLING_1654,
};

// OSRS game ticks are 600 ms, so convert the known cooldowns to ticks once.
const SPELL_COOLDOWN_SECONDS = 10.2;
const SPELL_COOLDOWN_TICKS = Math.max(
	1,
	Math.round((SPELL_COOLDOWN_SECONDS * 1000) / 600),
);
const TARGET_EFFECT_COOLDOWN_SECONDS = 61.2;
const TARGET_EFFECT_COOLDOWN_TICKS = Math.max(
	1,
	Math.round((TARGET_EFFECT_COOLDOWN_SECONDS * 1000) / 600),
);
const CAST_CONFIRMATION_TIMEOUT_TICKS = 5;

// A cast is pending until a Magic XP increase proves that Dark Lure succeeded.
type PendingCast = {
	target: net.runelite.api.NPC;
	startedAt: number;
	magicExperienceBeforeCast: number;
};

// State that lasts for one script run. It is reset in onStart().
const scriptState = {
	anchorX: 0,
	anchorY: 0,
	gameTick: 0,
	lastCastAt: 0,
	lastCastByTarget: new Map<string, number>(),
	lastLogTick: new Map<string, number>(),
	pendingCast: null as PendingCast | null,
};

// Avoid repeating the same diagnostic message on every game tick.
function shouldLog(key: string): boolean {
	const lastTick = scriptState.lastLogTick.get(key) ?? -3;
	if (scriptState.gameTick - lastTick >= 2) {
		scriptState.lastLogTick.set(key, scriptState.gameTick);
		return true;
	}
	return false;
}

// Read the enabled impling types and return the NPC IDs used by the search.
function getSelectedImplingIds(): number[] {
	return (Object.keys(IMPLING_IDS) as ImplingType[])
		.filter((type) => bot.bmCache.getBoolean(`autoDarklure.${type}`, true))
		.map((type) => IMPLING_IDS[type]);
}

// NPC indexes distinguish individual implings that share the same NPC ID.
function getTargetKey(npc: net.runelite.api.NPC): string {
	return `${npc.getIndex()}:${npc.getId()}`;
}

// Check the global delay that applies after every confirmed Dark Lure cast.
function isSpellOnCooldown(): boolean {
	return (
		scriptState.lastCastAt > 0 &&
		scriptState.gameTick - scriptState.lastCastAt < SPELL_COOLDOWN_TICKS
	);
}

// Check the longer effect delay for one specific impling.
function isTargetOnCooldown(npc: net.runelite.api.NPC): boolean {
	const key = getTargetKey(npc);
	const lastCastTick = scriptState.lastCastByTarget.get(key);
	if (lastCastTick === undefined) {
		return false;
	}
	return scriptState.gameTick - lastCastTick < TARGET_EFFECT_COOLDOWN_TICKS;
}

// Start the global cooldown at the current script tick.
function setSpellCooldown(): void {
	scriptState.lastCastAt = scriptState.gameTick;
}

// Start the per-impling cooldown for this NPC index and ID combination.
function setTargetCooldown(npc: net.runelite.api.NPC): void {
	scriptState.lastCastByTarget.set(getTargetKey(npc), scriptState.gameTick);
}

// Forget cooldowns for implings that are no longer loaded in the game client.
function removeDespawnedTargetCooldowns(): void {
	if (scriptState.lastCastByTarget.size === 0) {
		return;
	}

	const activeTargetKeys = new Set<string>();
	// Build a set of every currently visible selected impling.
	for (const implingId of getSelectedImplingIds()) {
		for (const npc of bot.npcs.getWithIds([implingId])) {
			activeTargetKeys.add(getTargetKey(npc));
		}
	}

	// An NPC slot may later be reused, so do not keep its old cooldown entry.
	for (const targetKey of scriptState.lastCastByTarget.keys()) {
		if (!activeTargetKeys.has(targetKey)) {
			scriptState.lastCastByTarget.delete(targetKey);
		}
	}
}

// Return true while a cast is still being confirmed or has just been confirmed.
function isPendingCastResolved(): boolean {
	const pendingCast = scriptState.pendingCast;
	if (!pendingCast) {
		return false;
	}

	const currentMagicExperience = client.getSkillExperience(
		net.runelite.api.Skill.MAGIC,
	);
	// A Magic XP increase is the confirmation that the spell actually cast.
	if (currentMagicExperience > pendingCast.magicExperienceBeforeCast) {
		setSpellCooldown();
		setTargetCooldown(pendingCast.target);
		log.print(
			`[AutoDarklure] Dark Lure confirmed on ${pendingCast.target.getName() ?? 'impling'}`,
		);
		scriptState.pendingCast = null;
		return true;
	}

	// Keep the player in place while the client has time to report the XP drop.
	if (
		scriptState.gameTick - pendingCast.startedAt <
		CAST_CONFIRMATION_TIMEOUT_TICKS
	) {
		return true;
	}

	// No XP arrived in time: do not set cooldowns, allowing a future retry.
	log.print(
		`[AutoDarklure] Dark Lure was not confirmed on ${pendingCast.target.getName() ?? 'impling'}; retrying`,
	);
	scriptState.pendingCast = null;
	return false;
}

// Find the nearest enabled impling that is in range and not on its own cooldown.
function getClosestSelectedImpling(): net.runelite.api.NPC | null {
	const selectedIds = getSelectedImplingIds();
	if (selectedIds.length === 0) {
		if (shouldLog('no-implings-selected')) {
			log.print('[AutoDarklure] No impling types selected');
		}
		return null;
	}

	const player = client.getLocalPlayer();
	if (!player) {
		if (shouldLog('player-not-found')) {
			log.print('[AutoDarklure] Player not found');
		}
		return null;
	}

	let closestImpling: net.runelite.api.NPC | null = null;
	let closestDistance = Number.MAX_VALUE;

	// Query each selected NPC ID, then keep the closest qualifying NPC found.
	for (const implingId of selectedIds) {
		const npcsWithId = bot.npcs.getWithIds([implingId]);
		if (npcsWithId.length > 0) {
			for (const npc of npcsWithId) {
				if (!isTargetOnCooldown(npc)) {
					const distribution = npc
						.getWorldLocation()
						.distanceTo(player.getWorldLocation());
					// The configurable range prevents targeting implings across the scene.
					if (
						distribution <= getSearchRange() &&
						distribution < closestDistance
					) {
						closestDistance = distribution;
						closestImpling = npc;
					}
				}
			}
		}
	}

	if (closestImpling && shouldLog('found-target')) {
		log.print(
			`[AutoDarklure] Found target: ${closestImpling.getName() ?? 'impling'} (ID: ${closestImpling.getId()}) at distance ${closestDistance}`,
		);
	}

	return closestImpling;
}

// BotMaker calls this once when the user starts the script.
export function onStart(): void {
	log.print('[AutoDarklure] Script loaded');
	// Clear run-specific state before displaying the saved UI settings.
	scriptState.lastCastAt = 0;
	scriptState.lastCastByTarget.clear();
	scriptState.pendingCast = null;
	scriptState.anchorX = 0;
	scriptState.anchorY = 0;
	uiOnStart();
}

// BotMaker calls this once per game tick; this is the script's main loop.
export function onGameTick(): void {
	// Do not interact with the game until the user confirms the startup UI.
	if (!isUiCompleted()) {
		return;
	}

	// Use our own counter because it is reliable for this script's tick timing.
	scriptState.gameTick += 1;

	const player = client.getLocalPlayer();
	if (!player) {
		return;
	}

	// A pending cast blocks searching and walking until it succeeds or times out.
	if (isPendingCastResolved()) {
		return;
	}

	// Remove cooldown records belonging to implings that have despawned.
	removeDespawnedTargetCooldowns();

	const worldLocation = player.getWorldLocation();

	// Record the first valid player tile as the location to return to after luring.
	if (scriptState.anchorX === 0 && scriptState.anchorY === 0) {
		scriptState.anchorX = worldLocation.getX();
		scriptState.anchorY = worldLocation.getY();
	}

	// Dark Lure can pull the player; return when more than two tiles from anchor.
	const distanceFromAnchor = Math.max(
		Math.abs(worldLocation.getX() - scriptState.anchorX),
		Math.abs(worldLocation.getY() - scriptState.anchorY),
	);
	if (distanceFromAnchor > 2) {
		// Request movement back to the anchor tile.
		bot.walking.walkToWorldPoint(scriptState.anchorX, scriptState.anchorY);
		// Wait for an idle player before resuming target selection.
		if (player.getPoseAnimation() !== -1) {
			return;
		}
	}

	// A confirmed cast pauses all future Dark Lure attempts during its global delay.
	if (isSpellOnCooldown()) {
		return;
	}

	// There is nothing to cast if no enabled impling is in the selected range.
	const target = getClosestSelectedImpling();
	if (!target) {
		return;
	}

	// This guard also protects against a target changing state between search and cast.
	if (isTargetOnCooldown(target)) {
		if (shouldLog(`cooldown-${target.getId()}`)) {
			log.print(
				`[AutoDarklure] Target on cooldown: ${target.getName() ?? 'impling'} (ID: ${target.getId()})`,
			);
		}
		return;
	}

	// Store the XP baseline before clicking so the next ticks can confirm the result.
	log.print(
		`[AutoDarklure] Casting Dark Lure on ${target.getName() ?? 'impling'} (ID: ${target.getId()})`,
	);
	scriptState.pendingCast = {
		target,
		startedAt: scriptState.gameTick,
		magicExperienceBeforeCast: client.getSkillExperience(
			net.runelite.api.Skill.MAGIC,
		),
	};
	// Ask BotMaker to cast the spell; cooldowns begin only after Magic XP confirms it.
	bot.magic.castOnNpc('DARK_LURE', target);
}

// BotMaker calls this once when the script stops.
export function onEnd(): void {
	uiOnEnd();
	log.print('[AutoDarklure] Script ended');
}
