(() => {
    const brand = document.querySelector("header .brand");
    if (!brand || brand.querySelector(".brand-home")) return;

    const content = brand.querySelector(":scope > .brand-left") || (() => {
        const logo = brand.querySelector(":scope > img.logo");
        const title = logo?.nextElementSibling;
        return logo && title && title.tagName !== "NAV" && title.tagName !== "A"
            ? { logo, title }
            : null;
    })();

    if (!content) return;

    const link = document.createElement("a");
    link.className = "brand-home";
    link.href = "/dashboard";
    link.setAttribute("aria-label", "Retour au dashboard");
    brand.insertBefore(link, content.logo || content);

    if (content.logo) {
        link.append(content.logo, content.title);
    } else {
        link.append(content);
    }
})();
