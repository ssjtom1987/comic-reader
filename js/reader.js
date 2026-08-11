(function () {
  "use strict";

  const issues = [
    {
      id: "issue-01",
      number: 1,
      title: "The Dutch Wedding",
      folder: "./issue-01/",
      coverFilename: "01 - The Dutch Wedding_Cover.png",
      pageFilenames: Array.from({ length: 14 }, (_, index) => `Page${index + 1}.png`),
      status: "available"
    },
    {
      id: "issue-02",
      number: 2,
      title: "Coming Soon",
      folder: null,
      coverFilename: null,
      pageFilenames: [],
      status: "coming-soon"
    }
  ];

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5;
  const ZOOM_STEP = 1.25;
  const DRAG_THRESHOLD = 7;

  const libraryScreen = document.getElementById("libraryScreen");
  const libraryHeading = document.getElementById("libraryHeading");
  const issueGrid = document.getElementById("issueGrid");
  const readerScreen = document.getElementById("readerScreen");
  const backToLibraryButton = document.getElementById("backToLibraryButton");
  const viewer = document.getElementById("viewer");
  const comicPage = document.getElementById("comicPage");
  const previousButton = document.getElementById("previousButton");
  const nextButton = document.getElementById("nextButton");
  const zoomOutButton = document.getElementById("zoomOutButton");
  const zoomInButton = document.getElementById("zoomInButton");
  const resetZoomButton = document.getElementById("resetZoomButton");
  const pageLabel = document.getElementById("pageLabel");
  const pagePosition = document.getElementById("pagePosition");
  const zoomLevel = document.getElementById("zoomLevel");
  const loadError = document.getElementById("loadError");

  let activeIssue = null;
  let currentPages = [];
  let currentIndex = -1;
  let fitScale = 1;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let canPanImage = false;
  let primaryGesture = null;
  let pinchGesture = null;
  let gestureUsedPinch = false;
  const activePointers = new Map();
  const preloadedPages = new Map();

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function fileUrl(issue, filename) {
    const folder = issue.folder.replace(/^\/+|\/+$/g, "");
    return `${folder}/${encodeURIComponent(filename)}`;
  }

  function issuePages(issue) {
    return [
      {
        filename: issue.coverFilename,
        label: "Cover",
        alt: `${issue.title} cover`
      },
      ...issue.pageFilenames.map((filename, index) => ({
        filename,
        label: `Page ${index + 1}`,
        alt: `${issue.title}, page ${index + 1}`
      }))
    ];
  }

  function renderIssueLibrary() {
    const fragment = document.createDocumentFragment();

    issues.forEach((issue) => {
      const card = document.createElement("article");
      card.className = "issue-card";
      card.setAttribute("aria-labelledby", `${issue.id}-title`);

      if (issue.status === "available") {
        const coverButton = document.createElement("button");
        coverButton.className = "issue-cover-button";
        coverButton.type = "button";
        coverButton.setAttribute("aria-label", `Read Issue ${issue.number}: ${issue.title}`);

        const coverImage = document.createElement("img");
        coverImage.src = fileUrl(issue, issue.coverFilename);
        coverImage.alt = `${issue.title} cover`;
        coverImage.decoding = "async";
        coverButton.appendChild(coverImage);
        coverButton.addEventListener("click", () => openIssue(issue));
        card.appendChild(coverButton);
      } else {
        card.classList.add("coming-soon-card");
        const placeholder = document.createElement("div");
        placeholder.className = "issue-cover-placeholder";
        placeholder.setAttribute("aria-hidden", "true");

        const number = document.createElement("span");
        number.className = "placeholder-number";
        number.textContent = String(issue.number).padStart(2, "0");

        const status = document.createElement("span");
        status.className = "placeholder-status";
        status.textContent = "Coming Soon";

        placeholder.append(number, status);
        card.appendChild(placeholder);
      }

      const details = document.createElement("div");
      details.className = "issue-details";

      const issueNumber = document.createElement("p");
      issueNumber.className = "issue-number";
      issueNumber.textContent = `Issue ${issue.number}`;

      const title = document.createElement("h2");
      title.id = `${issue.id}-title`;
      title.textContent = issue.title;

      details.append(issueNumber, title);

      if (issue.status === "available") {
        const readButton = document.createElement("button");
        readButton.className = "read-issue-button";
        readButton.type = "button";
        readButton.textContent = "Read Issue";
        readButton.addEventListener("click", () => openIssue(issue));
        details.appendChild(readButton);
      }

      card.appendChild(details);
      fragment.appendChild(card);
    });

    issueGrid.replaceChildren(fragment);
  }

  function updateZoomControls() {
    const zoomText = `${Math.round(zoom * 100)}%`;
    zoomLevel.value = zoomText;
    zoomLevel.textContent = zoomText;
    zoomOutButton.disabled = zoom <= MIN_ZOOM;
    zoomInButton.disabled = zoom >= MAX_ZOOM;
  }

  function calculateFitScale() {
    if (!comicPage.naturalWidth || !comicPage.naturalHeight) {
      return 1;
    }

    const viewerStyle = window.getComputedStyle(viewer);
    const padding = parseFloat(viewerStyle.getPropertyValue("--viewer-padding")) || 0;
    const availableWidth = Math.max(1, viewer.clientWidth - padding * 2);
    const availableHeight = Math.max(1, viewer.clientHeight - padding * 2);

    return Math.min(
      availableWidth / comicPage.naturalWidth,
      availableHeight / comicPage.naturalHeight,
      1
    );
  }

  function clampPan(displayWidth, displayHeight) {
    const maxPanX = Math.max(0, (displayWidth - viewer.clientWidth) / 2);
    const maxPanY = Math.max(0, (displayHeight - viewer.clientHeight) / 2);

    panX = clamp(panX, -maxPanX, maxPanX);
    panY = clamp(panY, -maxPanY, maxPanY);
  }

  function renderImage() {
    updateZoomControls();

    if (
      readerScreen.hidden ||
      !comicPage.naturalWidth ||
      !comicPage.naturalHeight ||
      viewer.clientWidth === 0 ||
      viewer.clientHeight === 0
    ) {
      return;
    }

    const renderedScale = fitScale * zoom;
    const displayWidth = comicPage.naturalWidth * renderedScale;
    const displayHeight = comicPage.naturalHeight * renderedScale;

    clampPan(displayWidth, displayHeight);

    comicPage.style.width = `${displayWidth}px`;
    comicPage.style.height = `${displayHeight}px`;
    comicPage.style.left = `${(viewer.clientWidth - displayWidth) / 2 + panX}px`;
    comicPage.style.top = `${(viewer.clientHeight - displayHeight) / 2 + panY}px`;

    canPanImage =
      displayWidth > viewer.clientWidth + 0.5 ||
      displayHeight > viewer.clientHeight + 0.5;
    viewer.classList.toggle("is-zoomed", canPanImage);
  }

  function setZoom(nextZoom, anchorClientX, anchorClientY) {
    const boundedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (boundedZoom === zoom || readerScreen.hidden) {
      return;
    }

    const viewerRect = viewer.getBoundingClientRect();
    const anchorX = anchorClientX == null ? viewerRect.left + viewerRect.width / 2 : anchorClientX;
    const anchorY = anchorClientY == null ? viewerRect.top + viewerRect.height / 2 : anchorClientY;
    const relativeX = anchorX - (viewerRect.left + viewerRect.width / 2);
    const relativeY = anchorY - (viewerRect.top + viewerRect.height / 2);
    const ratio = boundedZoom / zoom;

    panX = relativeX - ratio * (relativeX - panX);
    panY = relativeY - ratio * (relativeY - panY);
    zoom = boundedZoom;
    renderImage();
  }

  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    renderImage();
  }

  function preloadAround(index) {
    [index - 1, index + 1].forEach((nearbyIndex) => {
      if (nearbyIndex < 0 || nearbyIndex >= currentPages.length) {
        return;
      }

      const source = fileUrl(activeIssue, currentPages[nearbyIndex].filename);
      if (preloadedPages.has(source)) {
        return;
      }

      const image = new Image();
      image.decoding = "async";
      image.src = source;
      preloadedPages.set(source, image);
    });
  }

  function handleImageLoad() {
    if (!comicPage.naturalWidth || !comicPage.naturalHeight) {
      return;
    }

    comicPage.classList.remove("is-loading");
    comicPage.hidden = false;
    loadError.hidden = true;

    if (!readerScreen.hidden) {
      fitScale = calculateFitScale();
      renderImage();
    }
  }

  function showPage(index) {
    if (
      !activeIssue ||
      index < 0 ||
      index >= currentPages.length ||
      index === currentIndex
    ) {
      return;
    }

    currentIndex = index;
    const page = currentPages[currentIndex];
    zoom = 1;
    panX = 0;
    panY = 0;
    fitScale = 1;
    canPanImage = false;
    viewer.classList.remove("is-zoomed", "is-dragging");
    updateZoomControls();

    loadError.hidden = true;
    comicPage.hidden = false;
    comicPage.classList.add("is-loading");
    comicPage.alt = page.alt;
    comicPage.src = fileUrl(activeIssue, page.filename);

    pageLabel.textContent = page.label;
    pagePosition.textContent = `${currentIndex + 1} / ${currentPages.length}`;
    previousButton.disabled = currentIndex === 0;
    nextButton.disabled = currentIndex === currentPages.length - 1;
    preloadAround(currentIndex);

    if (comicPage.complete && comicPage.naturalWidth) {
      window.requestAnimationFrame(handleImageLoad);
    }
  }

  function previousPage() {
    showPage(currentIndex - 1);
  }

  function nextPage() {
    showPage(currentIndex + 1);
  }

  function releasePointerState() {
    activePointers.forEach((_, pointerId) => {
      if (viewer.hasPointerCapture(pointerId)) {
        viewer.releasePointerCapture(pointerId);
      }
    });
    activePointers.clear();
    primaryGesture = null;
    pinchGesture = null;
    gestureUsedPinch = false;
    viewer.classList.remove("is-dragging");
  }

  function openIssue(issue) {
    if (issue.status !== "available") {
      return;
    }

    activeIssue = issue;
    currentPages = issuePages(issue);
    currentIndex = -1;
    preloadedPages.clear();
    releasePointerState();

    libraryScreen.hidden = true;
    readerScreen.hidden = false;
    readerScreen.setAttribute("aria-label", `${issue.title} comic reader`);
    document.title = `${issue.title} — Comic Reader`;

    showPage(0);
    viewer.focus({ preventScroll: true });
  }

  function showIssueLibrary() {
    releasePointerState();
    readerScreen.hidden = true;
    libraryScreen.hidden = false;
    document.title = "Comic Library";
    libraryHeading.focus({ preventScroll: true });
  }

  function makePrimaryGesture(pointer, alreadyMoved) {
    primaryGesture = {
      pointerId: pointer.pointerId,
      startX: pointer.clientX,
      startY: pointer.clientY,
      startPanX: panX,
      startPanY: panY,
      moved: Boolean(alreadyMoved)
    };
  }

  function startPinch() {
    const pointers = Array.from(activePointers.values()).slice(0, 2);
    if (pointers.length < 2) {
      pinchGesture = null;
      return;
    }

    const viewerRect = viewer.getBoundingClientRect();
    const centerX = (pointers[0].clientX + pointers[1].clientX) / 2;
    const centerY = (pointers[0].clientY + pointers[1].clientY) / 2;
    pinchGesture = {
      distance: Math.hypot(
        pointers[1].clientX - pointers[0].clientX,
        pointers[1].clientY - pointers[0].clientY
      ),
      zoom,
      panX,
      panY,
      centerX: centerX - (viewerRect.left + viewerRect.width / 2),
      centerY: centerY - (viewerRect.top + viewerRect.height / 2)
    };
    gestureUsedPinch = true;
    if (primaryGesture) {
      primaryGesture.moved = true;
    }
  }

  backToLibraryButton.addEventListener("click", showIssueLibrary);
  previousButton.addEventListener("click", previousPage);
  nextButton.addEventListener("click", nextPage);
  zoomOutButton.addEventListener("click", () => setZoom(zoom / ZOOM_STEP));
  zoomInButton.addEventListener("click", () => setZoom(zoom * ZOOM_STEP));
  resetZoomButton.addEventListener("click", resetZoom);

  comicPage.addEventListener("load", handleImageLoad);

  comicPage.addEventListener("error", () => {
    comicPage.classList.remove("is-loading");
    comicPage.hidden = true;
    loadError.hidden = false;
  });

  viewer.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const scaleFactor = Math.exp(-event.deltaY * 0.0015);
      setZoom(zoom * scaleFactor, event.clientX, event.clientY);
    },
    { passive: false }
  );

  viewer.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    viewer.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, event);

    if (activePointers.size === 1) {
      gestureUsedPinch = false;
      makePrimaryGesture(event, false);
    } else if (activePointers.size === 2) {
      startPinch();
    }
  });

  viewer.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, event);

    if (activePointers.size >= 2) {
      if (!pinchGesture) {
        startPinch();
      }

      const pointers = Array.from(activePointers.values()).slice(0, 2);
      const distance = Math.hypot(
        pointers[1].clientX - pointers[0].clientX,
        pointers[1].clientY - pointers[0].clientY
      );
      const viewerRect = viewer.getBoundingClientRect();
      const currentCenterX =
        (pointers[0].clientX + pointers[1].clientX) / 2 -
        (viewerRect.left + viewerRect.width / 2);
      const currentCenterY =
        (pointers[0].clientY + pointers[1].clientY) / 2 -
        (viewerRect.top + viewerRect.height / 2);
      const nextZoom = clamp(
        pinchGesture.zoom * (distance / Math.max(1, pinchGesture.distance)),
        MIN_ZOOM,
        MAX_ZOOM
      );
      const ratio = nextZoom / pinchGesture.zoom;

      zoom = nextZoom;
      panX = currentCenterX - ratio * (pinchGesture.centerX - pinchGesture.panX);
      panY = currentCenterY - ratio * (pinchGesture.centerY - pinchGesture.panY);
      viewer.classList.add("is-dragging");
      renderImage();
      return;
    }

    if (!primaryGesture || primaryGesture.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - primaryGesture.startX;
    const deltaY = event.clientY - primaryGesture.startY;
    if (Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
      primaryGesture.moved = true;
    }

    if (canPanImage && primaryGesture.moved) {
      panX = primaryGesture.startPanX + deltaX;
      panY = primaryGesture.startPanY + deltaY;
      viewer.classList.add("is-dragging");
      renderImage();
    }
  });

  function finishPointer(event) {
    if (!activePointers.has(event.pointerId)) {
      return;
    }

    const shouldNavigate =
      event.type === "pointerup" &&
      activePointers.size === 1 &&
      primaryGesture &&
      primaryGesture.pointerId === event.pointerId &&
      !primaryGesture.moved &&
      !gestureUsedPinch;

    activePointers.delete(event.pointerId);
    if (viewer.hasPointerCapture(event.pointerId)) {
      viewer.releasePointerCapture(event.pointerId);
    }

    if (activePointers.size === 1) {
      const remainingPointer = Array.from(activePointers.values())[0];
      makePrimaryGesture(remainingPointer, true);
      pinchGesture = null;
    } else if (activePointers.size === 0) {
      primaryGesture = null;
      pinchGesture = null;
      gestureUsedPinch = false;
      viewer.classList.remove("is-dragging");
    }

    if (shouldNavigate) {
      const viewerRect = viewer.getBoundingClientRect();
      if (event.clientX < viewerRect.left + viewerRect.width / 2) {
        previousPage();
      } else {
        nextPage();
      }
    }
  }

  viewer.addEventListener("pointerup", finishPointer);
  viewer.addEventListener("pointercancel", finishPointer);

  window.addEventListener("keydown", (event) => {
    if (readerScreen.hidden || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousPage();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nextPage();
    } else if (event.key === "Escape") {
      event.preventDefault();
      showIssueLibrary();
    }
  });

  function handleViewerResize() {
    if (readerScreen.hidden || !comicPage.naturalWidth) {
      return;
    }

    fitScale = calculateFitScale();
    renderImage();
  }

  if ("ResizeObserver" in window) {
    const viewerResizeObserver = new ResizeObserver(handleViewerResize);
    viewerResizeObserver.observe(viewer);
  } else {
    window.addEventListener("resize", handleViewerResize);
  }

  renderIssueLibrary();
  updateZoomControls();
})();
