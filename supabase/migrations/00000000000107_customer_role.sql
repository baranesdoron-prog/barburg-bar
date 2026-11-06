-- Customers: people who drink at the bar (news, menu, punchcards) as
-- opposed to staff. On its own because a new enum value can't be used in
-- the same transaction that adds it.
alter type app_role add value if not exists 'customer';
