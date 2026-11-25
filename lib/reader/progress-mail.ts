import type { GameState } from "../state/game-state.ts";

export type ProgressMail = {
  id: `progress-${string}`;
  sender: string;
  address: string;
  subject: string;
  body: string;
  time: string;
};

// Deliver only milestones already reached. IDs are stable across repeated polls.
export function progressMail(state: GameState): ProgressMail[] {
  if (state.packId !== "volunteer-17") return [];
  const events = new Set(state.eventHistory.map(event => event.storyEventId));
  const clues = new Set(state.discoveredClueIds);
  const visited = (scene: string) => state.currentSceneId === scene ||
    state.eventHistory.some(event => event.sceneId === scene);
  const mails: ProgressMail[] = [];
  function add(id: string, subject: string, body: string) {
    mails.push({ id: `progress-${id}`, sender: "陌生人", address: "unknown@relay.invalid",
      subject, body, time: `来信 ${mails.length + 1}` });
  }
  add("archive", "先别让他急着离开", "你已经接上他的线路了。他还不知道你是谁，先让他明白你为什么想救他。\n\n档案室那份装订好的报告不是全部。让他看看柜子最下层的散页，再核对手机里的目录。别只拿着封面上的结论就走。");
  if (clues.has("c003")) add("versions", "两份记录对不上", "你们已经发现版本差异了。别急着把修改者说死，先留住两份记录。\n\n如果还没看手机里的匿名目录，趁他还在档案室时问他。那份目录能带你们找到设备日志的位置。");
  if (visited("s02")) add("corridor", "走廊里的人在找他", "别让他直接迎上去。办公室的文件柜后、旁边的储物间，都能暂时遮住他。\n\n等黑针走远，再决定去二楼还是撤出去。离开能保住人，但楼里的原始记录不会自己跟着出来。");
  if (events.has("e014")) add("upstairs", "二楼终端还留着记录", "既然决定继续，就去观察室的电脑。设备日志和监测记录要放在一起看。\n\n还有事故后的内部讨论，不要只翻正式报告。看完讨论，再核对正式版本缺了什么。");
  if (clues.has("c007")) add("discussion", "先看看他们怎么讨论事故", "时间已经对上了。现在最容易漏掉的是内部沟通文件。\n\n问他能不能先看事故后的讨论，再比对正式报告。保存好文件后，别急着打开门，先看走廊。");
  if (visited("s04")) add("wait", "现在还不是对峙的时候", "你们手上的记录还解释不了全部责任。让他留在遮挡后，等那束手电光离开。\n\n地下设备室有旧项目档案柜。风险评估、内部邮件和修改记录，都在那一带。");
  if (visited("s05")) add("backup", "把版本和来源一起留住", "不要只看一份材料。事故前的风险记录、内部邮件、修改账号和不同版本，需要互相核对。\n\n再看看下一阶段研究的安排。离开前核验补充文件，保存副本，别把唯一的材料交给黑针。");
  if (visited("s06")) {
    const complete = Array.from({ length: 14 }, (_, i) => `c${String(i + 1).padStart(3, "0")}`).every(id => clues.has(id));
    add("final", "他已经到大厅了", complete
      ? "记录已经串起来了。这次你们有完整证据，不必只靠愤怒。\n\n让黑针对着证据说话，值班人员可以听见。你也看见了曲别针口袋里的刀——最后怎么做，你说的话会有分量，后果不会因为真相被找到就消失。"
      : "我核对过你们找到的记录，还有缺口。别把推测当作已经证明的事实。\n\n大厅里有人，别急着升级冲突。保住现有材料；单靠威胁或愤怒补不齐缺失的记录。");
  }
  return mails;
}
