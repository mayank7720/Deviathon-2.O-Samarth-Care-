-- Participants can see delivery acknowledgement for their own sent messages.
-- The existing restrictive parent-message check still rejects unrelated users.
create policy conversation_participant_receipts on public.care_events for select to authenticated
 using(kind='communication_read' and private.care_message_receipt(senior_id,payload,false));
