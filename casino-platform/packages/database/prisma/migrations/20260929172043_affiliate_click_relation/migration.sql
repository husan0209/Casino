-- AddForeignKey
ALTER TABLE "affiliate_attributions" ADD CONSTRAINT "affiliate_attributions_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "affiliate_clicks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
