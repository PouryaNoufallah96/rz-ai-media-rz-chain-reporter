import { reportLowScoreFailures } from "../schemas/report";

const thresholds = {
  lexicalTopicScore: 40,
  policyScore: 60,
};

const policyOnly = reportLowScoreFailures(
  {
    disposition: "low_score",
    lexicalTopicScore: 75,
    policyScore: 59,
  },
  thresholds,
  true,
);
if (policyOnly.join() !== "policy") {
  throw new Error("policy-only failure was not classified correctly");
}

const topicOnly = reportLowScoreFailures(
  {
    disposition: "low_score",
    lexicalTopicScore: 39,
    policyScore: 80,
  },
  thresholds,
  true,
);
if (topicOnly.join() !== "lexical_topic") {
  throw new Error("topic-only failure was not classified correctly");
}

const both = reportLowScoreFailures(
  {
    disposition: "low_score",
    lexicalTopicScore: 0,
    policyScore: 30,
  },
  thresholds,
  true,
);
if (both.join() !== "policy,lexical_topic") {
  throw new Error("combined failure was not classified correctly");
}

const noTopics = reportLowScoreFailures(
  {
    disposition: "low_score",
    lexicalTopicScore: null,
    policyScore: 59,
  },
  thresholds,
  false,
);
if (noTopics.join() !== "policy") {
  throw new Error("topic gate ran without configured topics");
}

const shortlisted = reportLowScoreFailures(
  {
    disposition: "shortlisted",
    lexicalTopicScore: 0,
    policyScore: 30,
  },
  thresholds,
  true,
);
if (shortlisted.length !== 0) {
  throw new Error("non-low-score disposition was classified as rejected");
}

process.stdout.write("PASS editorial report policy\n");
