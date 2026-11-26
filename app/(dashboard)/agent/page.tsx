import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { VoiceAgent } from "@/components/agent/voice-agent";

export const metadata = { title: "Live Agent" };

export default function AgentPage() {
  return (
    <>
      <PageHeader title="Live Agent" description="Real-time voice conversation with the EstateAI sales agent" />
      <PageBody>
        <VoiceAgent />
      </PageBody>
    </>
  );
}
