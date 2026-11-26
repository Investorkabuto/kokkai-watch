/**
 * 法案の進み具合(プログレスバー)を審議経過から組み立てる。
 * 先に審議した院(先議院)を判定し、
 * 提出 → 先議院 委員会 → 先議院 本会議 → 後議院 委員会 → 後議院 本会議 → 公布 の6段階で表す。
 */
import type { BillEventData, BillStage, House } from "./shugiin";

export interface ProgressStep {
  label: string;
  date: string | null;
  result: string | null;
  state: "done" | "failed" | "todo";
}

export function buildProgress(events: Pick<BillEventData, "date" | "house" | "stage" | "result">[]): ProgressStep[] {
  const received = events
    .filter((e) => e.house && (e.stage === "received" || e.stage === "referred"))
    .sort((a, b) => a.date.localeCompare(b.date));
  const first: House = (received[0]?.house as House | undefined) ?? "衆議院";
  const second: House = first === "衆議院" ? "参議院" : "衆議院";
  const find = (house: House | null, stage: BillStage) => events.find((e) => e.house === house && e.stage === stage);

  const submitted = find(first, "received") ?? find(first, "preliminary_received");
  const steps: { label: string; ev: (typeof events)[number] | undefined }[] = [
    { label: "提出", ev: submitted },
    { label: `${first.slice(0, 1)} 委員会`, ev: find(first, "committee_decided") },
    { label: `${first.slice(0, 1)} 本会議`, ev: find(first, "plenary_decided") },
    { label: `${second.slice(0, 1)} 委員会`, ev: find(second, "committee_decided") },
    { label: `${second.slice(0, 1)} 本会議`, ev: find(second, "plenary_decided") },
    { label: "公布", ev: find(null, "promulgated") },
  ];
  let failed = false;
  return steps.map(({ label, ev }) => {
    if (failed) return { label, date: null, result: null, state: "todo" };
    if (!ev) return { label, date: null, result: null, state: "todo" };
    const isFail = !!ev.result && /否決|不承認|撤回/.test(ev.result);
    if (isFail) failed = true;
    return { label, date: ev.date, result: ev.result, state: isFail ? "failed" : "done" };
  });
}

export const STAGE_LABEL: Record<BillStage, string> = {
  preliminary_received: "予備審査のため受理",
  received: "議案受理",
  referred: "委員会に付託",
  committee_decided: "委員会で採決",
  plenary_decided: "本会議で採決",
  promulgated: "公布",
};
