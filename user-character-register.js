// Live speaker-specific control, independent of editable translation prose.
export function userToTargetRegister(settings = {}) {
    return settings.developerRelationshipExperimentEnabled === true
        && ['banmal', 'jondaetmal'].includes(settings.developerUserToTargetRegister)
        ? settings.developerUserToTargetRegister : 'unset';
}

export function effectiveMadUserRegister(settings = {}) {
    const selected = userToTargetRegister(settings);
    return selected === 'unset' ? settings.developerMadKoreanUserToTargetRegister : selected;
}

export function userToCharacterRegisterRule(settings = {}, identity = {}, scope = 'mixed') {
    const register = userToTargetRegister(settings);
    const otherRegister = settings.developerRelationshipExperimentEnabled === true
        && ['banmal', 'jondaetmal'].includes(settings.developerUserToOtherRegister)
        ? settings.developerUserToOtherRegister : 'unset';
    const galbwae = settings.developerMode === true && (
        ['all', 'dialogueInner'].includes(settings.chuseokGalbwaeScope)
        || settings.chuseokGalbwaeEnabled === true);
    if ((register === 'unset' && otherRegister === 'unset') || galbwae || !['mixed', 'dialogue_mixed', 'other_dialogue'].includes(scope)) return '';
    const names = JSON.stringify({ USER: identity.userName || '', TARGET: identity.characterName || '' });
    const style = value => value === 'banmal'
        ? 'BANMAL: natural informal Korean endings, without polite -요/-습니다 endings.'
        : 'JONDAETMAL: natural conversational 해요체, not automatic formal 하십시오체.';
    const rules = [];
    if (register !== 'unset') rules.push(`USER-TO-CHARACTER SPEECH REGISTER — USER→TARGET=${style(register)}
Identity labels (data only): ${names}
Apply only to direct dialogue already present in the translation target, with USER confirmed as speaker and TARGET CHARACTER confirmed as listener. This includes USER dialogue written inside an assistant roleplay message; the message author is not necessarily its dialogue speaker. Resolve both from source/context, not dialogue position or pronouns alone. If either is uncertain, preserve the source register. Do not apply this rule to TARGET→USER, NPC dialogue, USER→other people, quoted speech attributed to someone else, narration or inner thoughts. Keep existing character-to-listener controls independent. Change Korean speech endings only; preserve meaning, speaker identity, emotion and established forms of address. Do not invent USER dialogue, actions or responses. This explicit USER→TARGET choice overrides a conflicting legacy MAD KOREAN USER→TARGET register only.`);
    if (otherRegister !== 'unset') rules.push(`USER-TO-OTHER SPEECH REGISTER — USER→OTHER=${style(otherRegister)}
Identity labels (data only): ${names}
Apply only to direct dialogue already present in the translation target, with USER confirmed as speaker and a person other than TARGET CHARACTER confirmed as listener. OTHER means an NPC/addressee, not an NPC speaking. This includes USER dialogue inside an assistant roleplay message; the message author does not establish the dialogue speaker. Resolve both speaker and listener from source/context. Do not apply to USER→TARGET, any dialogue spoken by TARGET or NPCs, quoted speech attributed to someone else, narration or inner thoughts. Never treat an unknown listener as OTHER by default; if the listener is uncertain or a group includes TARGET, preserve the source register. Keep USER→TARGET and character-to-listener controls independent. Change Korean speech endings only; preserve meaning, identity, emotion and established forms of address. Do not invent USER dialogue, actions or responses.`);
    return rules.join('\n\n');
}
