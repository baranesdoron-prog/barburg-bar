-- Lets an item's position within its category's inventory-check/catalog
-- list be set explicitly, instead of always falling back to alphabetical.
-- Nullable: an item with no display_order sorts after every explicitly-
-- ordered one (within the same category), alphabetically among itself.
alter table inventory_items add column display_order integer;
