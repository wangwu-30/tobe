ALTER TABLE "CommentThread" ADD COLUMN "agentBindingsJson" TEXT;

ALTER TABLE "CommentMessage" ADD COLUMN "mentionedAgentsJson" TEXT;
ALTER TABLE "CommentMessage" ADD COLUMN "agentId" TEXT;
ALTER TABLE "CommentMessage" ADD COLUMN "agentLabel" TEXT;
