export const ticketIdProjectParser = {
  name: "ticket-id-project",
  parseEntry(entry, context) {
    if (context.meetingTaskNames.includes(entry.task)) {
      const bucketTag = entry.tags.find((tag) => context.meetingBucketTags[tag]);
      const bucket = bucketTag ? context.meetingBucketTags[bucketTag] : null;
      return {
        entryType: "meeting",
        taskId: null,
        activityCode: null,
        targetDescription: bucket ?? "Meeting",
        meetingBucket: bucket,
        needsReview: !bucket,
        reviewReasons: bucket ? [] : ["Meeting entry is missing a recognized meeting bucket tag."]
      };
    }

    const isTicket = context.ticketIdRegexes.some((regex) => regex.test(entry.task));
    if (isTicket) {
      const activityTag = entry.tags.find((tag) => context.activityDescriptionTags[tag]);
      return {
        entryType: "ticket_work",
        taskId: entry.task,
        activityCode: null,
        targetDescription: activityTag ? context.activityDescriptionTags[activityTag] : entry.tags[0] ?? "Work",
        meetingBucket: null,
        needsReview: !activityTag,
        reviewReasons: activityTag ? [] : ["Ticket entry is missing a recognized activity tag."]
      };
    }

    return {
      entryType: "other",
      taskId: null,
      activityCode: null,
      targetDescription: entry.tags[0] ?? "Other",
      meetingBucket: null,
      needsReview: true,
      reviewReasons: ["Project-specific parser could not classify the entry."]
    };
  }
};
