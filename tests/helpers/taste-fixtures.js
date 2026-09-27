export const segments = [
 {id:'n',type:'narration',text:'He waited.'},
 {id:'t',type:'dialogue_candidate',text:'"Come here."'},
 {id:'o',type:'dialogue_candidate',text:'"No."'},
 {id:'u',type:'dialogue_candidate',text:'"Wait."'},
 {id:'tag',type:'tagged_content',text:'Sunny'},
];
export const scope = {t:'target_dialogue',o:'other_dialogue',u:'unknown_dialogue'};
export const draft = () => new Map([['n','그는 기다렸다.'],['t','"이리 와."'],['o','"싫어."'],['u','"기다려."'],['tag','맑음']]);
export const settings = {developerMadKoreanOutputEnabled:true,developerHongjinFlavorEnabled:true,developerHongjinProfanity:'high',developerHongjinTeasing:'active',developerHongjinVulgarity:'open',developerHongjinPlayfulness:'high',developerHongjinAgeBand:'late20s',developerMadKoreanTargetToUserRegister:'banmal'};
export const identity = {characterName:'홍진',userName:'담은',characterGender:'male',nameLocks:[{source:'Hongjin',target:'홍진'}]};
export const args = (config = settings) => ({enabled:true,segmented:{segments,nameTokens:[],protectedText:segments.map(x=>x.text).join('\n')},translations:draft(),settings:config,speakerScopes:scope,speakerIdentity:identity,options:{}});
