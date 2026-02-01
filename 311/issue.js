const statusMessage = document.getElementById("issue-status");
const detailContainer = document.getElementById("issue-detail");

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
};

const addDetailRow = (list, label, value) => {
  if (value === null || value === undefined || value === "") return;
  const term = document.createElement("dt");
  term.textContent = label;
  const definition = document.createElement("dd");
  if (value instanceof HTMLElement) {
    definition.appendChild(value);
  } else {
    definition.textContent = value;
  }
  list.append(term, definition);
};

const renderIssueDetails = (issue) => {
  detailContainer.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = issue.summary || "Untitled issue";

  const description = document.createElement("p");
  description.textContent = issue.description || "No description provided.";

  const list = document.createElement("dl");

  addDetailRow(list, "Status", issue.status);
  addDetailRow(list, "Address", issue.address);
  addDetailRow(list, "Service Area", issue.service_area?.name);
  addDetailRow(list, "Reporter", issue.reporter?.name);
  addDetailRow(list, "Created", formatDate(issue.created_at));
  addDetailRow(list, "Updated", formatDate(issue.updated_at));
  addDetailRow(list, "Votes", issue.vote_count);
  addDetailRow(list, "Comments", issue.comment_count);
  addDetailRow(list, "Issue ID", issue.id || issue.issue_id);
  if (issue.lat && issue.lng) {
    addDetailRow(
      list,
      "Coordinates",
      `${Number(issue.lat).toFixed(5)}, ${Number(issue.lng).toFixed(5)}`
    );
  }

  if (issue.url) {
    const link = document.createElement("a");
    link.href = issue.url;
    link.className = "external-link";
    link.textContent = "View on SeeClickFix";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    addDetailRow(list, "External Link", link);
  }

  if (Array.isArray(issue.tags) && issue.tags.length) {
    addDetailRow(list, "Tags", issue.tags.join(", "));
  }

  detailContainer.append(title, description, list);
  detailContainer.hidden = false;
};

const loadIssue = async () => {
  const params = new URLSearchParams(window.location.search);
  const issueId = params.get("id");

  if (!issueId) {
    statusMessage.textContent = "No issue id provided.";
    return;
  }

  const url = `https://seeclickfix.com/api/v2/issues/${encodeURIComponent(
    issueId
  )}?details=true`;

  statusMessage.textContent = "Loading issue...";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Unable to load issue details.");
    }
    const data = await response.json();
    const issue = data.issue || data;
    if (!issue || typeof issue !== "object") {
      throw new Error("Issue details are unavailable.");
    }
    statusMessage.textContent = "";
    renderIssueDetails(issue);
  } catch (error) {
    statusMessage.textContent = error.message;
  }
};

loadIssue();
