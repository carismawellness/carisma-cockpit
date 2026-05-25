function onOpen() {
  if (typeof onOpenZohoMenu === "function")        onOpenZohoMenu();
  if (typeof onOpenEbidaLayerMenu === "function")  onOpenEbidaLayerMenu();
}
