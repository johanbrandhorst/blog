// Static comments
// from: https://github.com/eduardoboucas/popcorn/blob/gh-pages/js/main.js
(function ($) {
    $('.js-form').submit(function () {
      $('#submit_button').attr("disabled", "");
      $('#submit_button').attr("value", "Submitting");
      var form = this;

      $.ajax({
        type: $(this).attr('method'),
        url: $(this).attr('action'),
        data: $(this).serialize(),
        contentType: 'application/x-www-form-urlencoded',
        success: function (data) {
          showModal('Success', 'Thanks for your comment! It will show on the site once it has been approved.');
        },
        error: function (err) {
          console.log(err);
          showModal('Error', 'Sorry, there was an error with the submission');
        }
      });

      return false;
    });

    $('.js-close-modal').click(function () {
      $('body').removeClass('show-modal');
      $('#submit_button').removeAttr("disabled");
      $('#submit_button').attr("value", "Submit");
    });

    function showModal(title, message) {
      $('.js-modal-title').text(title);
      $('.js-modal-text').html(message);

      $('body').addClass('show-modal');
    }
  })(jQuery);
