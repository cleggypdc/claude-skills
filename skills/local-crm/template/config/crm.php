<?php
/**
 * CRM configuration. Edit per business; changes apply on the next request (config/ is mounted read-only in Docker).
 * Keys of stages/segments/personas are stored in the DB, so rename labels freely but don't rename keys that have data.
 */
return [
    'app_name' => 'Outbound CRM',
    'timezone' => 'Europe/London',

    // Pipeline, in order. 'open' stages are the ones a contact can move forward through.
    'stages' => [
        'new' => 'New',
        'queued' => 'Queued',
        'contacted' => 'Contacted',
        'replied' => 'Replied',
        'meeting' => 'Meeting',
        'opportunity' => 'Opportunity',
        'customer' => 'Customer',
        'not_now' => 'Not now',
        'not_interested' => 'Not interested',
    ],
    'open_stages' => ['new', 'queued', 'contacted', 'replied', 'meeting', 'opportunity'],

    // What can be logged against a contact, and what each one does.
    // stage: move forward to this stage (never backwards) | force: set it even from a closed stage
    // next: [text, days after the activity] sets the next action; null clears it; omit to leave it alone
    // dnc: true marks do-not-contact
    'activities' => [
        'note' => ['label' => 'Note'],
        'linkedin_connect' => ['label' => 'LinkedIn connect sent', 'stage' => 'contacted', 'next' => ['Check connect accepted; email if not', 7]],
        'connect_accepted' => ['label' => 'Connect accepted', 'next' => ['Send first message', 0]],
        'linkedin_message' => ['label' => 'LinkedIn message sent', 'stage' => 'contacted', 'next' => ['Send follow-up', 7]],
        'email_sent' => ['label' => 'Email sent', 'stage' => 'contacted', 'next' => ['Send follow-up', 7]],
        'followup_sent' => ['label' => 'Follow-up sent', 'stage' => 'contacted', 'next' => ['Last nudge or park as Not now', 14]],
        'call' => ['label' => 'Call'],
        'reply' => ['label' => 'Reply received', 'stage' => 'replied', 'next' => ['Respond to reply', 0]],
        'meeting_booked' => ['label' => 'Meeting booked', 'stage' => 'meeting', 'next' => ['Prep for meeting', 0]],
        'meeting_held' => ['label' => 'Meeting held', 'stage' => 'meeting', 'next' => ['Send meeting follow-up', 0]],
        'proposal_sent' => ['label' => 'Proposal / quote sent', 'stage' => 'opportunity', 'next' => ['Chase proposal', 5]],
        'won' => ['label' => 'Won', 'stage' => 'customer', 'force' => true, 'next' => null],
        'opted_out' => ['label' => 'Opted out / asked not to be contacted', 'stage' => 'not_interested', 'force' => true, 'dnc' => true, 'next' => null],
    ],

    // Who you sell to. Segments separate ICP versions or campaigns so you can compare reply rates.
    'segments' => ['icp_v1' => 'ICP v1'],
    'default_segment' => 'icp_v1',
    'personas' => ['founder', 'owner', 'manager', 'practitioner', 'buyer', 'champion', 'other'],
    'account_categories' => ['core', 'adjacent', 'other'],

    // Data rules (the prospecting playbook's guard rails).
    'require_source_url' => true,          // every contact must say where you found them
    'email_sources' => ['found_public', 'enrichment_free_tier', 'they_gave_it', 'existing_customer'], // email is rejected without one of these
];
