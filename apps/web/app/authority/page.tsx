import { AuthorityConsole } from "./console";
import { PageHead } from "@/components/page-head";

export const metadata = {
  title: "The authority, live — Mandate",
  description:
    "A spending authority enforcing a policy anchored on Sepolia against a budget persisted in MongoDB. Spend it down; the refusal survives a reload.",
};

export default function AuthorityPage() {
  return (
    <>
      <PageHead rubric="Live" title="Spend it down.">
        The policy is read from PolicyRegistry on Sepolia and the budget from a database, so
        neither is something this page can decide. Approved spends move real tUSDC through
        KeeperHub. Keep going until the money runs out — then reload, and watch the refusal still
        be true.
      </PageHead>

      <div className="shell py-10 sm:py-14">
        <div className="max-w-4xl">
          <AuthorityConsole />
        </div>
      </div>
    </>
  );
}
