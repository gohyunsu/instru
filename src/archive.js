const image = (name) => `./assets/illustrations/${name}.webp`;

const events = [
  {
    id: "graduation",
    date: "08 Oct 2026",
    title: "A graduation, and one more chorus",
    note: "The kind of goodbye that turns into another group photo.",
    images: ["graduation-1", "graduation-2"],
  },
  {
    id: "afterparty",
    date: "05 Oct 2026",
    title: "The encore after the encore",
    note: "Four frames, several attempts at looking composed.",
    images: ["traditional-afterparty"],
  },
  {
    id: "eighteenth",
    date: "05 Sep 2026",
    title: "Our 18th cohort",
    note: "My fellow voices, and an unusually cooperative camera.",
    images: ["eighteenth-1", "eighteenth-2", "eighteenth-3"],
  },
  {
    id: "traditional",
    date: "05 Sep 2026",
    title: "Traditional team",
    note: "Danny Boy, Ipanema, and the moments after the curtain.",
    images: ["traditional-stage-1", "traditional-stage-2"],
  },
  {
    id: "popular",
    date: "05 Sep 2026",
    title: "Popular team 1",
    note: "DUMDi DUMDi and And July, with a little extra energy.",
    images: ["popular-stage"],
  },
  {
    id: "camp",
    date: "01 Aug 2026",
    title: "Music camp",
    note: "More people than chairs. Exactly right.",
    images: ["music-camp-1", "music-camp-2"],
  },
];

function makeCarousel(host, names, label) {
  let current = 0;
  host.classList.add("memory-carousel");
  const picture = document.createElement("img");
  picture.loading = "lazy";
  picture.alt = `Watercolor illustration of ${label}`;
  const counter = document.createElement("span");
  counter.className = "carousel-counter";
  const previous = document.createElement("button");
  const next = document.createElement("button");
  previous.type = next.type = "button";
  previous.className = "carousel-arrow carousel-previous";
  next.className = "carousel-arrow carousel-next";
  previous.setAttribute("aria-label", `Previous ${label} illustration`);
  next.setAttribute("aria-label", `Next ${label} illustration`);
  previous.textContent = "←";
  next.textContent = "→";
  const update = () => {
    picture.src = image(names[current]);
    picture.alt = `Watercolor illustration ${current + 1} of ${names.length}: ${label}`;
    counter.textContent = `${current + 1} / ${names.length}`;
  };
  previous.addEventListener("click", () => {
    current = (current - 1 + names.length) % names.length;
    update();
  });
  next.addEventListener("click", () => {
    current = (current + 1) % names.length;
    update();
  });
  host.append(picture);
  if (names.length > 1) host.append(previous, next, counter);
  update();
}

document.querySelectorAll("[data-carousel]").forEach((host) => {
  const names = host.dataset.carousel.split(",");
  makeCarousel(host, names, host.dataset.label || "Instru friends");
});

const gallery = document.querySelector("#galleryGrid");
const dialog = document.querySelector("#galleryDialog");
const dialogImage = document.querySelector("#galleryDialogImage");
const dialogTitle = document.querySelector("#galleryDialogTitle");
const dialogDate = document.querySelector("#galleryDialogDate");
const dialogNote = document.querySelector("#galleryDialogNote");
const dialogCount = document.querySelector("#galleryDialogCount");
let activeEvent = null;
let activeIndex = 0;
let opener = null;

function showDialogImage() {
  dialogImage.src = image(activeEvent.images[activeIndex]);
  dialogImage.alt = `Watercolor illustration ${activeIndex + 1} of ${activeEvent.images.length}: ${activeEvent.title}`;
  dialogCount.textContent = `${activeIndex + 1} / ${activeEvent.images.length}`;
  dialog.querySelectorAll("[data-gallery-step]").forEach((button) => {
    button.hidden = activeEvent.images.length < 2;
  });
}

function openEvent(event, trigger) {
  activeEvent = event;
  activeIndex = 0;
  opener = trigger;
  dialogTitle.textContent = event.title;
  dialogDate.textContent = event.date;
  dialogNote.textContent = event.note;
  showDialogImage();
  dialog.showModal();
}

for (const event of events) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "gallery-card";
  card.setAttribute("aria-label", `Open ${event.title}, ${event.images.length} illustrations`);
  const picture = document.createElement("img");
  picture.src = image(event.images[0]);
  picture.alt = "";
  picture.loading = "lazy";
  const label = document.createElement("span");
  label.className = "gallery-card-label";
  label.innerHTML = `<small>${event.date}</small><strong>${event.title}</strong>`;
  card.append(picture, label);
  card.addEventListener("click", () => openEvent(event, card));
  gallery.append(card);
}

dialog.querySelectorAll("[data-gallery-step]").forEach((button) => {
  button.addEventListener("click", () => {
    activeIndex =
      (activeIndex + Number(button.dataset.galleryStep) + activeEvent.images.length) %
      activeEvent.images.length;
    showDialogImage();
  });
});
dialog.querySelector("[data-gallery-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => opener?.focus());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("keydown", (event) => {
  if (!activeEvent || activeEvent.images.length < 2) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    activeIndex =
      (activeIndex + (event.key === "ArrowRight" ? 1 : -1) + activeEvent.images.length) %
      activeEvent.images.length;
    showDialogImage();
  }
});
